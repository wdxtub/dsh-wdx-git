/**
 * AI helpers: commit-message drafting (quick + detailed), model catalog and
 * conflict resolution suggestions.
 *
 * The host owns what the model sees (diff, file list, recent commits, branch);
 * a user-supplied prompt can only change *how* the message is written.
 */
import { readFile } from 'node:fs/promises'
import { isAbsolute, join, relative } from 'node:path'
import { GitError, brief } from './git.js'

const QUICK_DIFF_LIMIT = 12000
const DETAILED_DIFF_LIMIT = 30000
const MAX_UNTRACKED_FILES = 5
const MAX_UNTRACKED_BYTES = 24000

export const QUICK_SYSTEM_PROMPT = [
  'You write Git commit messages for a software repository.',
  'Return only the commit message, with no explanation, quotes or code fences.',
  '',
  'Format:',
  '- Subject line: Conventional Commits, e.g. "fix(auth): reject expired sessions". Keep it under 72 characters, imperative, specific, no trailing period.',
  '- If the change needs motivation, impact or a non-obvious trade-off, add one blank line and a body. Wrap body lines near 72 characters.',
  '- Do not pad tiny changes with a body.',
  '- Follow the repository\'s recent commit language and style: recent subjects in Chinese mean a Chinese message; otherwise English.',
  '- Never claim tests, issues or files that are not visible in the provided diff.',
].join('\n')

export const DETAILED_SYSTEM_PROMPT = [
  'You are a senior engineer preparing a commit message that follows the project\'s own conventions.',
  'Return only the commit message, with no explanation, quotes or code fences.',
  '',
  'Think about the change as one coherent commit:',
  '- Start from the actual diff. Identify the dominant intent and the user-visible behavior change; do not enumerate every file.',
  '- Reuse the repository\'s format and language. If recent commits use Conventional Commits, use "<type>(<scope>): <subject>" and choose an honest type and scope. If they use plain sentences, follow that.',
  '- Subject: concrete and specific, under 72 characters, no trailing period. Describe what changed, not "update code".',
  '- Body: separate with a blank line. Explain why the change is needed, what behavior changes, and any constraints or migration notes. Mention verification (tests, manual checks) only when the provided material shows it.',
  '- If the changes mix unrelated concerns, summarize the dominant one honestly instead of inventing one theme; do not claim files or effects that are absent.',
  '- Skip the body for a genuinely tiny change.',
  '',
  'Follow the repository\'s recent commit language: recent subjects in Chinese mean a Chinese message; otherwise English.',
].join('\n')

/**
 * Resolve a model selection and clamp its reasoning effort.
 *
 * Preference `auto` picks `low` when the model supports it, otherwise the
 * cheapest "off"-like effort, otherwise the provider default (no effort).
 *
 * @param {{
 *   llm: any,
 *   explicit?: {provider?: string, model?: string, reasoningEffort?: string}|null,
 *   fallback?: {provider?: string, model?: string, reasoningEffort?: string}|null,
 *   effortPreference?: string,
 * }} options
 */
export async function resolveModelSelection(options) {
  const { llm } = options
  if (!llm) throw new GitError('AI 服务不可用（宿主没有 llm 服务）', { code: 'ai-unavailable' })
  const candidate = options.explicit?.provider && options.explicit?.model
    ? options.explicit
    : options.fallback
  if (!candidate || !candidate.provider || !candidate.model) {
    throw new GitError('没有可用的模型：当前会话尚未选择模型', { code: 'ai-unavailable' })
  }
  let models
  try {
    models = await llm.listModels(candidate.provider)
  } catch (error) {
    throw new GitError(`无法读取模型列表：${brief(error?.message ?? error, 500)}`, { code: 'ai-unavailable' })
  }
  if (!models.some((model) => model.id === candidate.model)) {
    throw new GitError(`模型不可用：${candidate.provider}/${candidate.model}`, { code: 'ai-unavailable' })
  }
  let info = null
  try {
    info = await llm.resolveModelInfo(candidate.provider, candidate.model)
  } catch {
    info = null
  }
  const efforts = Array.isArray(info?.reasoning?.efforts) ? info.reasoning.efforts.map((effort) => effort.id) : []
  const preference = options.effortPreference || 'auto'
  let effort
  if (preference === 'auto') effort = chooseLowEffort(efforts)
  else if (preference === 'default') effort = undefined
  else if (efforts.includes(preference)) effort = preference
  else effort = chooseLowEffort(efforts)
  return {
    provider: candidate.provider,
    model: candidate.model,
    reasoningEffort: effort,
    label: `${candidate.provider}/${candidate.model}`,
    efforts,
    effortName: effortNameOf(info?.reasoning?.efforts, effort),
  }
}

/** Pick `low`, else an off/none effort, else leave it to the provider. */
export function chooseLowEffort(efforts) {
  if (!Array.isArray(efforts) || efforts.length === 0) return undefined
  if (efforts.includes('low')) return 'low'
  const off = efforts.find((effort) => /^(none|off|disabled|no[-_]?reasoning)$/i.test(effort))
  return off
}

function effortNameOf(efforts, id) {
  if (!id || !Array.isArray(efforts)) return ''
  return efforts.find((effort) => effort.id === id)?.name ?? id
}

/**
 * Build the browser model catalog from the live LLM registry.
 * @param {any} llm
 */
export async function readModelCatalog(llm) {
  if (!llm) return { groups: [], failures: [] }
  const providers = typeof llm.listProviders === 'function' ? llm.listProviders() : []
  const groups = []
  const failures = []
  for (const provider of providers) {
    try {
      const models = await llm.listModels(provider.id)
      const entries = []
      for (const model of models) {
        let resolved = null
        try {
          resolved = await llm.resolveModelInfo(provider.id, model.id)
        } catch {
          resolved = null
        }
        const reasoning = resolved?.reasoning
          ? {
            efforts: resolved.reasoning.efforts.map((effort) => ({
              id: effort.id,
              name: effort.name,
              ...(effort.description === undefined ? {} : { description: effort.description }),
            })),
            ...(resolved.reasoning.defaultEffort === undefined ? {} : { defaultEffort: resolved.reasoning.defaultEffort }),
          }
          : undefined
        entries.push({
          id: model.id,
          name: model.name,
          ...(model.description === undefined ? {} : { description: model.description }),
          ...(reasoning === undefined ? {} : { reasoning }),
        })
      }
      if (entries.length > 0) groups.push({ id: provider.id, name: provider.name, models: entries })
    } catch (error) {
      failures.push({ id: provider.id, name: provider.name, message: brief(error?.message ?? error, 400) })
    }
  }
  return { groups, failures }
}

/**
 * Generate a commit message.
 *
 * @param {{
 *   runGit: (args: string[], options?: any) => Promise<{code: number|null, stdout: string, stderr: string}>,
 *   cwd: string,
 *   llm: any,
 *   selection: {provider: string, model: string, reasoningEffort?: string, label: string},
 *   mode?: 'quick'|'detailed',
 *   hint?: string,
 *   branch?: string,
 *   customPrompt?: string,
 *   signal?: AbortSignal,
 * }} options
 */
export async function draftCommitMessage(options) {
  const { runGit, cwd, llm, selection, signal } = options
  const mode = options.mode === 'detailed' ? 'detailed' : 'quick'
  const hint = String(options.hint ?? '').slice(0, 500)
  const branch = options.branch || ''
  const diffLimit = mode === 'detailed' ? DETAILED_DIFF_LIMIT : QUICK_DIFF_LIMIT
  const selected = Array.isArray(options.paths) && options.paths.length > 0 ? options.paths : null
  const pathArgs = selected === null ? [] : ['--', ...selected]

  const [trackedDiff, statusRaw, statRaw, recentRaw] = await Promise.all([
    runGit(['diff', 'HEAD', '--no-color', ...pathArgs], { cwd, signal, allowFailure: true }),
    runGit(['status', '--porcelain=v2', '-z', '--untracked-files=all'], { cwd, signal, allowFailure: true }),
    runGit(['diff', 'HEAD', '--stat', '--no-color', ...pathArgs], { cwd, signal, allowFailure: true }),
    runGit(['log', '-12', '--pretty=format:%s'], { cwd, signal, allowFailure: true }),
  ])

  const status = parseChangedFiles(statusRaw.stdout)
  const selectedSet = selected === null ? null : new Set(selected)
  const visibleFiles = selectedSet === null
    ? status.files
    : status.files.filter((label) => selectedSet.has(label.replace(/ \(new\)$/, '')))
  const visibleUntracked = selectedSet === null
    ? status.untracked
    : status.untracked.filter((path) => selectedSet.has(path))
  const visibleStatus = selectedSet === null ? status : { ...status, files: visibleFiles, untracked: visibleUntracked }
  const recent = String(recentRaw.stdout ?? '').split('\n').map((line) => line.trim()).filter(Boolean)
  const chinese = isChineseRepository(recent)
  let diff = String(trackedDiff.stdout ?? '')
  let stat = String(statRaw.stdout ?? '').trim()
  if (diff.trim() === '') {
    // An unborn branch has no HEAD, so `git diff HEAD` fails even when files
    // were staged. Fall back to the index diff so the model still sees them.
    const cached = await runGit(['diff', '--cached', '--no-color', ...pathArgs], { cwd, signal, allowFailure: true })
    diff = String(cached.stdout ?? '')
  }
  if (stat === '') {
    const cachedStat = await runGit(['diff', '--cached', '--stat', '--no-color', ...pathArgs], { cwd, signal, allowFailure: true })
    stat = String(cachedStat.stdout ?? '').trim()
  }

  let untrackedDetail = ''
  if (mode === 'detailed' && visibleUntracked.length > 0) {
    const pieces = []
    let budget = MAX_UNTRACKED_BYTES
    for (const path of visibleUntracked.slice(0, MAX_UNTRACKED_FILES)) {
      if (budget <= 0) break
      const text = await readSmallTextFile(cwd, path, Math.min(budget, 6000))
      if (text === null) continue
      budget -= text.length
      pieces.push(`--- new file: ${path}\n${text}`)
    }
    untrackedDetail = pieces.join('\n\n')
  }

  const data = buildDataBlock({
    mode,
    branch,
    recent,
    files: visibleFiles,
    stat,
    diff: diff.slice(0, diffLimit),
    diffTruncated: diff.length > diffLimit,
    untrackedDetail,
    hint,
  })

  const custom = String(options.customPrompt ?? '').trim().slice(0, 5000)
  const system = custom !== '' ? custom : (mode === 'detailed' ? DETAILED_SYSTEM_PROMPT : QUICK_SYSTEM_PROMPT)
  const output = await streamCompletion({
    llm,
    selection,
    system,
    user: data,
    maxTokens: mode === 'detailed' ? 1400 : 600,
    temperature: 0.2,
    signal,
  })

  const parsed = parseCommitMessage(output.text)
  if (!looksLikeSubject(parsed.subject, recent)) {
    return {
      subject: fallbackSubject(visibleStatus, chinese),
      body: '',
      message: fallbackSubject(visibleStatus, chinese),
      model: selection.label,
      fallback: true,
      truncated: output.finishKind === 'max-tokens',
    }
  }
  const message = parsed.body === '' ? parsed.subject : `${parsed.subject}\n\n${parsed.body}`
  return {
    subject: parsed.subject,
    body: parsed.body,
    message,
    model: selection.label,
    fallback: false,
    truncated: output.finishKind === 'max-tokens',
  }
}

function buildDataBlock(input) {
  const parts = []
  if (input.recent.length > 0) {
    parts.push('Recent commit subjects (style reference only):')
    for (const subject of input.recent) parts.push(`- ${subject}`)
    parts.push('')
  }
  if (input.branch) parts.push(`Current branch: ${input.branch}`, '')
  if (input.files.length > 0) {
    parts.push(`Changed files (${input.files.length}):`)
    for (const file of input.files.slice(0, 80)) parts.push(`- ${file}`)
    parts.push('')
  }
  if (input.stat) parts.push('Diff stat:', input.stat, '')
  if (input.hint) parts.push(`Extra context from the user: ${input.hint}`, '')
  if (input.untrackedDetail) {
    parts.push('Content of new files (truncated):', '```', input.untrackedDetail, '```', '')
  }
  parts.push('Changes that will be committed (all listed changes are auto-staged):')
  if (input.diff.trim() === '') {
    parts.push('(no textual diff for tracked files)')
  } else {
    parts.push('```diff', input.diff, '```')
    if (input.diffTruncated) parts.push('(diff truncated)')
  }
  if (input.mode === 'detailed') {
    parts.push('')
    parts.push('Write the message now. Prefer a specific subject; add a body only when it carries real information.')
  }
  return parts.join('\n')
}

function parseChangedFiles(raw) {
  const files = []
  const untracked = []
  for (const record of String(raw ?? '').split('\0')) {
    if (!record) continue
    if (record.startsWith('? ')) {
      const path = record.slice(2)
      files.push(`${path} (new)`)
      untracked.push(path)
      continue
    }
    if (record.startsWith('1 ') || record.startsWith('2 ') || record.startsWith('u ')) {
      const path = statusRecordPath(record)
      if (path) files.push(path)
    }
  }
  return { files: [...new Set(files)], untracked }
}

function statusRecordPath(record) {
  const ordinary = /^1 .. \S+ \S+ \S+ \S+ \S+ \S+ (.*)$/s.exec(record)
  if (ordinary) return ordinary[1]
  const renamed = /^2 .. \S+ \S+ \S+ \S+ \S+ \S+ \S+ (.*)$/s.exec(record)
  if (renamed) return renamed[1]
  const unmerged = /^u .. \S+ \S+ \S+ \S+ \S+ \S+ \S+ \S+ (.*)$/s.exec(record)
  if (unmerged) return unmerged[1]
  return ''
}

async function readSmallTextFile(cwd, path, limit) {
  try {
    const absolute = join(cwd, path)
    const rel = relative(cwd, absolute)
    if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return null
    const buffer = await readFile(absolute)
    if (buffer.length > 256 * 1024) return null
    const text = buffer.toString('utf8')
    if (text.includes('\0')) return null
    return text.slice(0, limit)
  } catch {
    return null
  }
}

function isChineseRepository(recent) {
  const joined = recent.join('')
  if (joined === '') return false
  const cjk = (joined.match(/[\u3400-\u9fff]/g) ?? []).length
  return cjk >= Math.max(1, Math.floor(joined.length * 0.2))
}

/** Normalize a model message into subject + optional body. */
export function parseCommitMessage(text) {
  const cleaned = stripFences(String(text ?? '')).replace(/\r\n/g, '\n')
  const lines = cleaned.split('\n')
  let index = 0
  while (index < lines.length && lines[index].trim() === '') index += 1
  const subjectLine = index < lines.length ? lines[index] : ''
  const rest = lines.slice(index + 1).join('\n')
  return { subject: cleanSubject(subjectLine), body: cleanBody(rest) }
}

function stripFences(text) {
  return text.replace(/^[ \t]*```[a-zA-Z0-9_+.-]*[ \t]*$/gm, '')
}

export function cleanSubject(value) {
  let subject = String(value ?? '')
    .replace(/^(commit message|提交信息|摘要)\s*[:：]\s*/i, '')
    .replace(/^[`"“”'‘’]+|[`"“”'‘’]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (subject.length > 100) subject = subject.slice(0, 100).trim()
  return subject
}

export function cleanBody(value) {
  const lines = stripFences(String(value ?? ''))
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
  while (lines.length > 0 && lines[0].trim() === '') lines.shift()
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop()
  let body = lines.join('\n').trim()
  body = body.replace(/^(commit body|提交正文|正文)\s*[:：]\s*/i, '')
  if (body.length > 3000) body = body.slice(0, 3000).trim()
  return body
}

/**
 * Reject obviously unusable model output: empty/half sentences, dangling
 * punctuation, unclosed brackets, or a lone Conventional prefix.
 * @param {string} subject
 * @param {string[]} [recent]
 */
export function looksLikeSubject(subject, recent = []) {
  const value = String(subject ?? '').trim()
  if (value.length < 6) return false
  if (value.length > 120) return false
  if (/[，,、；;：:（(「『"'"'+\-–—。]$/.test(value)) return false
  if (/(并|和|与|及|或|然后|以及|并且|同时|and|or|with|with the)$/i.test(value)) return false
  const open = (value.match(/（|\(/g) ?? []).length
  const close = (value.match(/）|\)/g) ?? []).length
  if (open !== close) return false
  if (/^(feat|fix|chore|docs|refactor|test|build|ci|perf|style|revert)(\([^)]*\))?!?\s*[:：]\s*$/i.test(value)) return false
  const conventional = /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([^)]+\))?!?\s*[:：]\s*\S/i
  const recentUsesConventional = recent.some((line) => conventional.test(line))
  if (recentUsesConventional && !conventional.test(value)) return false
  return true
}

function fallbackSubject(status, chinese) {
  const count = status.files.length
  if (chinese) {
    if (count === 0) return 'chore: 无文件变更'
    if (count === 1) return `chore: 更新 ${status.files[0].replace(' (new)', '')}`
    return `chore: 更新 ${count} 个文件`
  }
  if (count === 0) return 'chore: no file changes'
  if (count === 1) return `chore: update ${status.files[0].replace(' (new)', '')}`
  return `chore: update ${count} files`
}

/** Stream a model completion and collect text + terminal reason. */
async function streamCompletion({ llm, selection, system, user, maxTokens, temperature, signal }) {
  let text = ''
  let finishKind = null
  try {
    const stream = llm.stream({
      provider: selection.provider,
      model: selection.model,
      ...(selection.reasoningEffort === undefined ? {} : { reasoningEffort: selection.reasoningEffort }),
      system,
      messages: [{ role: 'user', content: [{ type: 'text', text: user }] }],
      maxTokens,
      temperature,
      signal,
    })
    for await (const chunk of stream) {
      if (chunk.type === 'text-delta') text += chunk.text
      if (chunk.type === 'finish') {
        finishKind = chunk.reason?.kind ?? null
        if (finishKind === 'error' || finishKind === 'aborted') {
          const failure = chunk.reason?.failure
          throw new GitError(`模型生成失败：${failure?.message ?? finishKind}`, { code: 'ai-unavailable' })
        }
      }
    }
  } catch (error) {
    if (error instanceof GitError) throw error
    throw new GitError(`模型生成失败：${brief(error?.message ?? error, 600)}`, { code: 'ai-unavailable' })
  }
  return { text, finishKind }
}

/**
 * Ask the model for a merged file. Does not write anything.
 * @param {{
 *   llm: any,
 *   selection: {provider: string, model: string, reasoningEffort?: string, label: string},
 *   path: string,
 *   base: string|null,
 *   ours: string,
 *   theirs: string,
 *   oursDeleted: boolean,
 *   theirsDeleted: boolean,
 *   branch: string,
 *   incoming: string,
 *   hint?: string,
 *   signal?: AbortSignal,
 * }} input
 */
export async function suggestConflictResolution(input) {
  const total = input.ours.length + input.theirs.length + (input.base?.length ?? 0)
  if (total > 240000) {
    throw new GitError('冲突文件过大（三份内容合计超过 240000 字符），请手动解决', { code: 'invalid-params' })
  }
  const system = [
    'You merge two versions of one file during a Git merge.',
    'Output ONLY the complete merged file content. No explanation, no markdown fences, no conflict markers.',
    'Keep the valuable changes from both sides, preserve the project style, and choose the higher version when both modify a version number.',
    'If a side deleted the file, its content is explicitly marked as deleted; decide whether deleting the file is the correct resolution.',
    'If deleting the file is correct, output exactly one line: <<<DELETE_FILE>>>',
    'When unsure, produce a coherent file rather than concatenating both versions.',
  ].join('\n')
  const parts = [
    `Path: ${input.path}`,
    `Current branch: ${input.branch || '(unknown)'}`,
    `Incoming branch/ref: ${input.incoming || '(unknown)'}`,
    '',
    input.hint ? `Extra context from the user: ${input.hint}` : '',
    '',
    '=== COMMON ANCESTOR (base) ===',
    input.base === null ? '(no common ancestor; add/add conflict)' : clip(input.base, 40000),
    '',
    '=== CURRENT BRANCH (ours) ===',
    input.oursDeleted ? '(deleted on this side; no content)' : clip(input.ours, 40000),
    '',
    '=== INCOMING SIDE (theirs) ===',
    input.theirsDeleted ? '(deleted on this side; no content)' : clip(input.theirs, 40000),
  ].join('\n')
  const output = await streamCompletion({
    llm: input.llm,
    selection: input.selection,
    system,
    user: parts,
    maxTokens: Math.min(8000, Math.max(1200, Math.ceil(total / 3) + 800)),
    temperature: 0.1,
    signal: input.signal,
  })
  if (output.finishKind === 'max-tokens') {
    throw new GitError('模型输出被截断，未写入任何内容。请重试或手动解决。', { code: 'ai-unavailable' })
  }
  const cleaned = stripFences(output.text).replace(/\r\n/g, '\n').trim()
  if (/^<<<DELETE_FILE>>>$/m.test(cleaned)) return { delete: true, content: null, model: input.selection.label }
  if (cleaned === '') throw new GitError('模型返回了空内容，未写入任何内容', { code: 'ai-unavailable' })
  if (hasConflictMarkers(cleaned)) {
    throw new GitError('模型返回的内容仍包含冲突标记，已拒绝写入', { code: 'ai-unavailable' })
  }
  return { delete: false, content: cleaned, model: input.selection.label }
}

function clip(text, max) {
  const value = String(text ?? '')
  return value.length <= max ? value : `${value.slice(0, max)}\n…(truncated)`
}

export function hasConflictMarkers(text) {
  return /^(<{7}|={7}|>{7})( |$)/m.test(String(text ?? ''))
}