/**
 * AI helpers: commit-message drafting (subject + detailed body, retried until
 * the format is valid), model catalog and conflict resolution suggestions.
 *
 * The host owns what the model sees (diff, file list, recent commits, branch);
 * a user-supplied prompt can only change *how* the message is written.
 */
import { readFile } from 'node:fs/promises'
import { isAbsolute, join, relative } from 'node:path'
import { GitError, brief } from './git.js'

const COMMIT_DIFF_LIMIT = 30000
const MAX_UNTRACKED_FILES = 5
const MAX_UNTRACKED_BYTES = 24000
const MAX_COMMIT_RETRIES = 3
const COMMIT_MAX_TOKENS = 1600
const RETRY_TOKEN_STEP = 600
const MAX_COMMIT_TOKENS = 3400
const BODY_REQUIRED_CHANGED_LINES = 5
const MIN_BODY_CHARS = 60
const MIN_BODY_UNIT_CHARS = 6

export const COMMIT_SYSTEM_PROMPT = [
  'You are a senior engineer writing a Git commit message for this repository.',
  'Return only the commit message: no explanation, quotes, code fences, headings or labels.',
  '',
  'Aim for the information density of a good pull request summary: more than a one-line shorthand, never an essay.',
  '- Line 1 is the subject: imperative, specific, at most 72 characters, no trailing period.',
  '- Use Conventional Commits "<type>(<scope>): <subject>" when the recent commits use them; otherwise match the repository\'s plain style.',
  '- Then one blank line, then a short body: one sentence stating the problem or motivation, followed by 2-4 bullet points naming the concrete changes. Cover interface changes (commands, flags, config keys, exports, protocols, persisted formats) and behavior changes (defaults, output, timing, UI flows) that the diff actually makes.',
  '- If the diff adds or changes tests, add one bullet saying what they cover. Never claim that tests were run.',
  '- Ground every sentence in the provided diff and use real file, function or command names. Never claim tests, issues, files or effects that are not visible, and avoid filler such as "update code", "improve logic" or "various fixes".',
  '- Omit the body only for a genuinely trivial change with no behavioral effect.',
  '',
  'Follow the repository\'s recent commit language: recent subjects in Chinese mean a Chinese message; otherwise English.',
  '',
  'Shape (illustrative; do not reuse its content or wording):',
  'refactor(auth): reject expired sessions before the handler runs',
  '',
  'Expired sessions reached the handler and failed with a confusing 500.',
  '',
  '- Check expiry in the auth middleware and return 401 with a clear message.',
  '- Drop the duplicate expiry check from the handler.',
  '- Extend the session tests with an expired-cookie case.',
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
 * One request writes subject + body. When the reply is unusable (truncated,
 * malformed subject, or a substantial change without a body) it is retried up
 * to MAX_COMMIT_RETRIES times with a corrective instruction. Only after that
 * does it fall back to a deterministic subject, so the commit can still go out.
 *
 * @param {{
 *   runGit: (args: string[], options?: any) => Promise<{code: number|null, stdout: string, stderr: string}>,
 *   cwd: string,
 *   llm: any,
 *   selection: {provider: string, model: string, reasoningEffort?: string, label: string},
 *   hint?: string,
 *   branch?: string,
 *   customPrompt?: string,
 *   signal?: AbortSignal,
 * }} options
 */
export async function draftCommitMessage(options) {
  const { runGit, cwd, llm, selection, signal } = options
  const hint = String(options.hint ?? '').slice(0, 500)
  const branch = options.branch || ''
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
  if (visibleUntracked.length > 0) {
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
    branch,
    recent,
    files: visibleFiles,
    stat,
    diff: diff.slice(0, COMMIT_DIFF_LIMIT),
    diffTruncated: diff.length > COMMIT_DIFF_LIMIT,
    untrackedDetail,
    hint,
  })

  const custom = String(options.customPrompt ?? '').trim().slice(0, 5000)
  const system = custom !== '' ? custom : COMMIT_SYSTEM_PROMPT
  // A custom prompt may deliberately write shorter messages, so only the
  // built-in prompt enforces a body for substantial changes.
  const requiresBody = custom === '' && needsDetailedBody({ diff, files: visibleFiles, untrackedDetail })

  let attempts = 0
  let lastValid = null
  let lastValidTruncated = false
  let lastProblem = ''
  let lastTruncated = false
  while (attempts <= MAX_COMMIT_RETRIES) {
    const output = await streamCompletion({
      llm,
      selection,
      system,
      user: attempts === 0 ? data : `${data}\n\n---\n${retryInstruction(lastProblem)}`,
      maxTokens: Math.min(MAX_COMMIT_TOKENS, COMMIT_MAX_TOKENS + attempts * RETRY_TOKEN_STEP),
      temperature: 0.2,
      signal,
    })
    attempts += 1
    const parsed = parseCommitMessage(output.text)
    lastTruncated = output.finishKind === 'max-tokens'
    if (looksLikeSubject(parsed.subject, recent)) {
      lastValid = parsed
      lastValidTruncated = lastTruncated
    }
    const problem = commitProblem(parsed, { recent, truncated: lastTruncated, requiresBody })
    if (problem === '') {
      return {
        subject: parsed.subject,
        body: parsed.body,
        message: parsed.body === '' ? parsed.subject : `${parsed.subject}\n\n${parsed.body}`,
        model: selection.label,
        fallback: false,
        truncated: false,
        attempts,
        warning: '',
      }
    }
    lastProblem = problem
  }

  if (lastValid !== null) {
    return {
      subject: lastValid.subject,
      body: '',
      message: lastValid.subject,
      model: selection.label,
      fallback: false,
      truncated: lastValidTruncated,
      attempts,
      warning: `模型连续 ${attempts} 次输出不合格（${lastProblem}），已只保留标题`,
    }
  }
  const subject = fallbackSubject(visibleStatus, chinese)
  return {
    subject,
    body: '',
    message: subject,
    model: selection.label,
    fallback: true,
    truncated: lastTruncated,
    attempts,
    warning: `模型连续 ${attempts} 次输出不合格（${lastProblem}），已使用降级文案`,
  }
}

function commitProblem(parsed, { recent, truncated, requiresBody }) {
  if (truncated) return '输出被截断，正文没有写完'
  if (parsed.subject.trim() === '') return '缺少标题行'
  if (!looksLikeSubject(parsed.subject, recent)) {
    return '标题格式不合格：需要一行完整的提交标题，缺 Conventional 前缀、半句话、结尾标点或括号不闭合都不行'
  }
  if (requiresBody && bodyChars(parsed.body) < MIN_BODY_CHARS) {
    return '缺少足够的正文：需要一句说明动机，再用 2-4 条要点写清具体改了什么、为什么'
  }
  if (requiresBody) {
    const quality = bodyQualityProblem(parsed.body)
    if (quality !== '') return quality
  }
  return ''
}

/** Reject a substantial change whose body is only one short thought. */
function bodyQualityProblem(body) {
  const units = String(body ?? '')
    .split(/\n+|[。！？!?；;]+|\.\s+/)
    .map((unit) => unit.trim())
    .filter((unit) => unit.length >= MIN_BODY_UNIT_CHARS)
  if (units.length < 2) {
    return '正文只有一句话：需要先说明动机，再列 2-4 条具体改动（涉及测试时补一条覆盖范围）'
  }
  return ''
}

function retryInstruction(problem) {
  return [
    `Your previous reply was rejected: ${problem}.`,
    'Reply again with ONLY the commit message in this exact shape:',
    '- one subject line (at most 72 characters, no trailing period),',
    '- one blank line,',
    '- one sentence of motivation, then 2-4 concrete bullet points (interface changes, behavior changes, and test coverage when the diff touches tests) taken from the diff above.',
    'No preamble, no quotes, no code fences, no markdown headings.',
  ].join('\n')
}

function needsDetailedBody({ diff, files, untrackedDetail }) {
  const changedLines = String(diff ?? '')
    .split('\n')
    .filter((line) => /^[+-]/.test(line) && !/^(\+\+\+|---)/.test(line))
    .length
  if (changedLines >= BODY_REQUIRED_CHANGED_LINES) return true
  if (files.length >= 2) return true
  if (String(untrackedDetail).length >= 200) return true
  return false
}

function bodyChars(body) {
  return String(body ?? '').replace(/\s+/g, '').length
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
  parts.push('')
  parts.push('Write the commit message now: subject line, one blank line, then a compact PR-style body — one sentence of motivation plus 2-4 concrete change bullets. Skip the body only for a truly trivial change.')
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

const CONFLICT_INPUT_LIMIT = 240000
const CONFLICT_MERGED_LIMIT = 12000
const CONFLICT_HUNK_LIMIT = 24000
const CONFLICT_MAX_HUNKS = 40
const CONFLICT_CONTEXT_LINES = 20

/**
 * Ask the model for a merged file. Does not write anything.
 *
 * Large files are not sent whole: the working-tree merge result is split into
 * conflict regions and each region is resolved with its surrounding context,
 * because a full-file reply would exceed the output budget.
 *
 * @param {{
 *   llm: any,
 *   selection: {provider: string, model: string, reasoningEffort?: string, label: string},
 *   path: string,
 *   base: string|null,
 *   ours: string,
 *   theirs: string,
 *   merged?: string,
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
  const merged = typeof input.merged === 'string' ? input.merged : ''
  if (total > CONFLICT_INPUT_LIMIT || merged.length > CONFLICT_MERGED_LIMIT) {
    if (hasConflictMarkers(merged)) return await resolveConflictByHunks(input, merged)
    throw new GitError(
      `冲突文件过大（三份内容合计 ${total} 字符，合并结果 ${merged.length} 字符），且没有可解析的冲突块，请手动解决`,
      { code: 'invalid-params' },
    )
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
  if (/^<<<DELETE_FILE>>>$/m.test(cleaned)) {
    return { delete: true, content: null, model: input.selection.label, route: 'whole' }
  }
  if (cleaned === '') throw new GitError('模型返回了空内容，未写入任何内容', { code: 'ai-unavailable' })
  if (hasConflictMarkers(cleaned)) {
    throw new GitError('模型返回的内容仍包含冲突标记，已拒绝写入', { code: 'ai-unavailable' })
  }
  return { delete: false, content: cleaned, model: input.selection.label, route: 'whole' }
}

const CONFLICT_HUNK_SYSTEM_PROMPT = [
  'You resolve one conflict region of a file during a Git merge.',
  'Output ONLY the replacement lines for this region. No explanation, quotes, code fences or conflict markers.',
  'Keep the valuable changes from both sides, preserve indentation and the surrounding style, and do not duplicate lines that both sides share.',
  'Do not invent code that neither side contains; keep the surrounding context intact.',
  'If the correct resolution removes the whole region, output exactly one line: <<<EMPTY_REGION>>>',
].join('\n')

/** Find conflict regions in a worktree merge result, or null when malformed. */
function findConflictRegions(text) {
  const lines = String(text ?? '').split('\n')
  const regions = []
  let index = 0
  while (index < lines.length) {
    if (!/^<{7}(\s|$)/.test(lines[index])) {
      index += 1
      continue
    }
    const start = index
    let base = -1
    let mid = -1
    let end = -1
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const line = lines[cursor]
      if (/^<{7}(\s|$)/.test(line)) return null
      if (mid === -1 && /^\|{7}(\s|$)/.test(line)) { base = cursor; continue }
      if (mid === -1 && /^={7}(\s|$)/.test(line)) { mid = cursor; continue }
      if (mid !== -1 && /^>{7}(\s|$)/.test(line)) { end = cursor; break }
    }
    if (mid === -1 || end === -1) return null
    regions.push({ start, base, mid, end })
    index = end + 1
  }
  return regions
}

/** Resolve each conflict region separately, then splice the replacements in. */
async function resolveConflictByHunks(input, merged) {
  const regions = findConflictRegions(merged)
  if (regions === null) {
    throw new GitError('无法解析冲突标记，请手动解决', { code: 'invalid-params' })
  }
  if (regions.length === 0) {
    throw new GitError('没有找到可自动解决的冲突块，请手动解决', { code: 'invalid-params' })
  }
  if (regions.length > CONFLICT_MAX_HUNKS) {
    throw new GitError(`冲突块过多（${regions.length} 个），请手动解决或分批处理`, { code: 'invalid-params' })
  }
  const lines = merged.split('\n')
  const replacements = []
  for (let index = 0; index < regions.length; index += 1) {
    const region = regions[index]
    const ours = lines.slice(region.start + 1, region.mid).join('\n')
    const theirs = lines.slice(region.mid + 1, region.end).join('\n')
    const base = region.base === -1 ? null : lines.slice(region.base + 1, region.mid).join('\n')
    const size = ours.length + theirs.length + (base === null ? 0 : base.length)
    if (size > CONFLICT_HUNK_LIMIT) {
      throw new GitError(`第 ${index + 1} 个冲突块过大（${size} 字符），请手动解决`, { code: 'invalid-params' })
    }
    const previousEnd = index === 0 ? 0 : regions[index - 1].end + 1
    const nextStart = index === regions.length - 1 ? lines.length : regions[index + 1].start
    const contextBefore = lines.slice(
      Math.max(previousEnd, region.start - CONFLICT_CONTEXT_LINES),
      region.start,
    )
    const contextAfter = lines.slice(
      region.end + 1,
      Math.min(nextStart, region.end + 1 + CONFLICT_CONTEXT_LINES),
    )
    const output = await streamCompletion({
      llm: input.llm,
      selection: input.selection,
      system: CONFLICT_HUNK_SYSTEM_PROMPT,
      user: buildHunkPrompt(input, {
        ours, theirs, base, contextBefore, contextAfter,
      }),
      maxTokens: Math.min(8000, Math.max(1200, Math.ceil(size / 2) + 600)),
      temperature: 0.1,
      signal: input.signal,
    })
    if (output.finishKind === 'max-tokens') {
      throw new GitError(`第 ${index + 1} 个冲突块的输出被截断，未写入任何内容`, { code: 'ai-unavailable' })
    }
    replacements.push(cleanHunkOutput(output.text, index))
  }
  const assembled = []
  let cursor = 0
  for (let index = 0; index < regions.length; index += 1) {
    const region = regions[index]
    assembled.push(...lines.slice(cursor, region.start))
    if (replacements[index] !== '') assembled.push(...replacements[index].split('\n'))
    cursor = region.end + 1
  }
  assembled.push(...lines.slice(cursor))
  const content = assembled.join('\n')
  if (content.trim() === '') {
    throw new GitError('合并结果为空，未写入任何内容；如应删除该文件，请手动删除', { code: 'ai-unavailable' })
  }
  if (hasConflictMarkers(content)) {
    throw new GitError('合并结果仍包含冲突标记，已拒绝写入', { code: 'ai-unavailable' })
  }
  return {
    delete: false,
    content,
    model: input.selection.label,
    route: 'hunks',
    hunks: regions.length,
  }
}

function buildHunkPrompt(input, hunk) {
  const parts = [
    `Path: ${input.path}`,
    `Current branch: ${input.branch || '(unknown)'}`,
    `Incoming branch/ref: ${input.incoming || '(unknown)'}`,
    '',
    input.hint ? `Extra context from the user: ${input.hint}` : '',
    '',
  ]
  if (hunk.contextBefore.length > 0) {
    parts.push('=== LINES BEFORE THE CONFLICT ===', clip(hunk.contextBefore.join('\n'), 4000), '')
  }
  parts.push('=== CURRENT BRANCH (ours) ===', clip(hunk.ours, CONFLICT_HUNK_LIMIT))
  if (hunk.base !== null) {
    parts.push('', '=== COMMON ANCESTOR (base) ===', clip(hunk.base, CONFLICT_HUNK_LIMIT))
  }
  parts.push('', '=== INCOMING SIDE (theirs) ===', clip(hunk.theirs, CONFLICT_HUNK_LIMIT))
  if (hunk.contextAfter.length > 0) {
    parts.push('', '=== LINES AFTER THE CONFLICT ===', clip(hunk.contextAfter.join('\n'), 4000))
  }
  return parts.join('\n')
}

function cleanHunkOutput(text, index) {
  let value = stripFences(String(text ?? '')).replace(/\r\n/g, '\n')
  value = value.replace(/^\n+/, '').replace(/\n+$/, '')
  if (value.trim() === '') {
    throw new GitError(`模型没有给出第 ${index + 1} 个冲突块的内容，未写入任何内容`, { code: 'ai-unavailable' })
  }
  if (value.split('\n').map((line) => line.trim()).filter(Boolean).every((line) => line === '<<<EMPTY_REGION>>>')) {
    return ''
  }
  if (hasConflictMarkers(value)) {
    throw new GitError(`第 ${index + 1} 个冲突块的结果仍包含冲突标记，已拒绝写入`, { code: 'ai-unavailable' })
  }
  return value
}

function clip(text, max) {
  const value = String(text ?? '')
  return value.length <= max ? value : `${value.slice(0, max)}\n…(truncated)`
}

export function hasConflictMarkers(text) {
  return /^(<{7}|={7}|>{7})( |$)/m.test(String(text ?? ''))
}