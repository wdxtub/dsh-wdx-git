/**
 * Host-side RPC operations for the WDX Git panel.
 *
 * Each request resolves the repository root, validates its parameters and
 * returns plain JSON. The only filesystem write is `applyResolution`, guarded
 * by a repository-relative path check and a re-read of the index conflict.
 */
import { access, readFile } from 'node:fs/promises'
import { basename, isAbsolute, join, relative } from 'node:path'
import { writeFile } from 'node:fs/promises'
import {
  GitError,
  brief,
  commandFailure,
  parseBranches,
  parseCommitInfo,
  parseDiff,
  parseGraph,
  parseRemotes,
  parseStashes,
  parseStatusV2,
} from './git.js'
import { integrate, unmergedFiles } from './sync.js'
import {
  draftCommitMessage,
  hasConflictMarkers,
  chooseLowEffort,
  readModelCatalog,
  resolveModelSelection,
  suggestConflictResolution,
} from './ai.js'

const READ_TIMEOUT = 30000
const WRITE_TIMEOUT = 60000
const NETWORK_TIMEOUT = 240000
const SYNC_TIMEOUT = 420000
const AI_TIMEOUT = 150000
const RESOLVE_AI_TIMEOUT = 360000
const DIFF_MAX_CHARS = 400000
const COMMIT_PROMPT_KEY = 'wdx.git.commitPrompt'
const COMMIT_PROMPT_MAX = 5000

const OPS = [
  'snapshot', 'graph', 'commitInfo', 'diff',
  'stage', 'unstage', 'discard',
  'switchBranch', 'createBranch', 'deleteBranch',
  'commit', 'fetch', 'pull', 'push', 'sync',
  'stashPush', 'stashPop', 'stashDrop',
  'aiCommit', 'models', 'setCommitPrompt',
  'conflictInfo', 'aiResolve', 'applyResolution', 'takeSide', 'markResolved',
  'abortOperation', 'continueOperation',
]

const SAFE_REF = /^[\p{L}\p{N}._/-]+$/u

function assertCwd(cwd) {
  if (typeof cwd !== 'string' || cwd.trim() === '') {
    throw new GitError('缺少 cwd 参数', { code: 'invalid-params' })
  }
  if (!isAbsolute(cwd)) {
    throw new GitError(`cwd 必须是绝对路径：${cwd}`, { code: 'invalid-params' })
  }
  if (cwd.includes('\0')) throw new GitError('cwd 含非法字符', { code: 'invalid-params' })
  return cwd
}

function assertPaths(paths) {
  if (!Array.isArray(paths) || paths.length === 0) {
    throw new GitError('paths 不能为空', { code: 'invalid-params' })
  }
  return paths.map((path) => {
    if (typeof path !== 'string' || path === '' || path.includes('\0')) {
      throw new GitError('paths 含非法条目', { code: 'invalid-params' })
    }
    if (isAbsolute(path)) throw new GitError(`path 必须是仓库内相对路径：${path}`, { code: 'invalid-params' })
    const segments = path.split('/').filter((segment) => segment !== '' && segment !== '.')
    if (segments.includes('..')) throw new GitError(`path 不能包含 ..：${path}`, { code: 'invalid-params' })
    if (segments.length === 0) throw new GitError('path 非法', { code: 'invalid-params' })
    return segments.join('/')
  })
}

function assertRelPath(value) {
  const [path] = assertPaths([value])
  return path
}

function assertRef(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new GitError(`缺少 ${label} 参数`, { code: 'invalid-params' })
  }
  if (value.startsWith('-') || value.includes('\0') || value.includes(' ')) {
    throw new GitError(`${label} 非法：${value}`, { code: 'invalid-params' })
  }
  if (!SAFE_REF.test(value)) throw new GitError(`${label} 含非法字符：${value}`, { code: 'invalid-params' })
  return value
}

function assertHash(value) {
  if (typeof value !== 'string' || !/^[0-9a-f]{4,40}$/.test(value)) {
    throw new GitError(`hash 非法：${String(value)}`, { code: 'invalid-params' })
  }
  return value
}

function joinOutput(...values) {
  return values.map((value) => String(value ?? '').trim()).filter(Boolean).join('\n')
}

/**
 * @param {{
 *   exec: (argv: string[], options: {cwd: string, signal?: AbortSignal, timeoutMs?: number}) => Promise<{code: number|null, stdout: string, stderr: string}>,
 *   services?: () => ({llm?: any, sessions?: any, defaultModel?: any}),
 *   fileIO?: {writeFile?: typeof writeFile},
 *   timeouts?: Record<string, number>,
 * }} deps
 */
export function createOperations(deps) {
  const { exec } = deps
  const services = deps.services ?? (() => ({}))
  const writeFileImpl = deps.fileIO?.writeFile ?? writeFile
  const timeouts = {
    read: READ_TIMEOUT,
    write: WRITE_TIMEOUT,
    network: NETWORK_TIMEOUT,
    sync: SYNC_TIMEOUT,
    ai: AI_TIMEOUT,
    resolveAi: RESOLVE_AI_TIMEOUT,
    ...(deps.timeouts ?? {}),
  }
  let catalogCache = null

  async function runGit(args, options = {}) {
    const { cwd, signal, timeoutMs = timeouts.read, allowFailure = false } = options
    const argv = ['git', ...args]
    const result = await exec(argv, { cwd, signal, timeoutMs })
    if (result.code !== 0 && !allowFailure) throw commandFailure(args, result)
    return result
  }

  async function repoRoot(cwd, signal) {
    const result = await runGit(['rev-parse', '--show-toplevel'], { cwd, signal, allowFailure: true })
    if (result.code === 0) {
      const root = result.stdout.trim()
      return { root: root === '' ? null : root, error: null }
    }
    const detail = joinOutput(result.stderr, result.stdout)
    return { root: null, error: detail || `git rev-parse --show-toplevel 退出码 ${result.code}` }
  }

  async function requireRepo(cwd, signal) {
    const resolved = await repoRoot(cwd, signal)
    if (!resolved.root) {
      throw new GitError(
        `当前目录不是 Git 仓库：${cwd}${resolved.error ? `（${brief(resolved.error, 500)}）` : ''}`,
        { code: 'not-a-repo' },
      )
    }
    return resolved.root
  }

  async function currentBranch(root, signal) {
    const result = await runGit(['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: root, signal, allowFailure: true,
    })
    const name = result.code === 0 ? result.stdout.trim() : ''
    if (name !== '' && name !== 'HEAD') return name
    // An unborn branch has no commit to resolve, but HEAD is already symbolic.
    const symbolic = await runGit(['symbolic-ref', '--short', 'HEAD'], {
      cwd: root, signal, allowFailure: true,
    })
    if (symbolic.code !== 0) return null
    const fallback = symbolic.stdout.trim()
    return fallback === '' || fallback === 'HEAD' ? null : fallback
  }

  async function readStatus(root, signal) {
    const result = await runGit(['status', '--porcelain=v2', '-z', '--branch', '--untracked-files=all'], {
      cwd: root, signal,
    })
    return parseStatusV2(result.stdout)
  }

  /** Detect an in-flight merge/rebase/cherry-pick/revert and conflict count. */
  async function operationState(root, signal) {
    const [status, merge, rebaseHead, cherryPick, revert] = await Promise.all([
      runGit(['diff', '--name-only', '--diff-filter=U', '-z'], { cwd: root, signal, allowFailure: true }),
      runGit(['rev-parse', '--verify', '--quiet', 'MERGE_HEAD'], { cwd: root, signal, allowFailure: true }),
      runGit(['rev-parse', '--verify', '--quiet', 'REBASE_HEAD'], { cwd: root, signal, allowFailure: true }),
      runGit(['rev-parse', '--verify', '--quiet', 'CHERRY_PICK_HEAD'], { cwd: root, signal, allowFailure: true }),
      runGit(['rev-parse', '--verify', '--quiet', 'REVERT_HEAD'], { cwd: root, signal, allowFailure: true }),
    ])
    let rebasing = rebaseHead.code === 0
    if (!rebasing) {
      for (const directory of ['rebase-merge', 'rebase-apply']) {
        const pathResult = await runGit(['rev-parse', '--git-path', directory], { cwd: root, signal, allowFailure: true })
        if (pathResult.code !== 0) continue
        const gitPath = pathResult.stdout.trim()
        try {
          await access(isAbsolute(gitPath) ? gitPath : join(root, gitPath))
          rebasing = true
          break
        } catch {
          // not present
        }
      }
    }
    return {
      merge: merge.code === 0,
      rebase: rebasing,
      cherryPick: cherryPick.code === 0,
      revert: revert.code === 0,
      conflicted: String(status.stdout ?? '').split('\0').filter(Boolean).length,
      inProgress: merge.code === 0 || rebasing || cherryPick.code === 0 || revert.code === 0,
    }
  }

  async function conflictStageHashes(root, path, signal) {
    const result = await runGit(['ls-files', '-u', '-z', '--', path], { cwd: root, signal, allowFailure: true })
    const stages = {}
    for (const record of String(result.stdout ?? '').split('\0')) {
      if (record === '') continue
      const tab = record.indexOf('\t')
      if (tab < 0) continue
      const fields = record.slice(0, tab).split(' ')
      const hash = fields[1]
      const stage = Number(fields[2])
      if (!hash || !Number.isInteger(stage) || stage < 1 || stage > 3) continue
      stages[stage] = hash
    }
    return stages
  }

  async function readBlob(root, hash, signal) {
    if (!hash) return null
    const result = await runGit(['cat-file', '-p', hash], { cwd: root, signal, allowFailure: true })
    return result.code === 0 ? result.stdout : null
  }

  async function loadConflict(root, path, signal) {
    const stages = await conflictStageHashes(root, path, signal)
    if (Object.keys(stages).length === 0) {
      throw new GitError(`该文件没有未解决的冲突：${path}`, { code: 'invalid-params' })
    }
    const [base, ours, theirs] = await Promise.all([
      readBlob(root, stages[1], signal),
      readBlob(root, stages[2], signal),
      readBlob(root, stages[3], signal),
    ])
    return { stages, base, ours: ours ?? '', theirs: theirs ?? '' }
  }

  async function incomingRef(root, signal) {
    for (const ref of ['MERGE_HEAD', 'REBASE_HEAD']) {
      const exists = await runGit(['rev-parse', '--verify', '--quiet', ref], { cwd: root, signal, allowFailure: true })
      if (exists.code !== 0) continue
      const name = await runGit(['name-rev', '--name-only', ref], { cwd: root, signal, allowFailure: true })
      if (name.code === 0 && name.stdout.trim() !== '') return name.stdout.trim()
      const subject = await runGit(['log', '-1', '--pretty=%s', ref], { cwd: root, signal, allowFailure: true })
      if (subject.code === 0 && subject.stdout.trim() !== '') return subject.stdout.trim()
    }
    return null
  }

  async function snapshot(params, signal) {
    const cwd = assertCwd(params.cwd)
    const resolved = await repoRoot(cwd, signal)
    if (!resolved.root) {
      return {
        repo: { isRepo: false, error: resolved.error },
        branches: [], remotes: [], stashes: [], status: null,
        operation: null, user: null, commitPrompt: '',
      }
    }
    const root = resolved.root
    const [status, branchesRaw, remotesRaw, stashRaw, headRaw, remoteUrlRaw, promptRaw, userNameRaw, userEmailRaw, opState] = await Promise.all([
      readStatus(root, signal),
      runGit([
        'for-each-ref', 'refs/heads', 'refs/remotes',
        '--format=%(refname)%00%(refname:short)%00%(objectname:short)%00%(upstream:short)%00%(upstream:track)%00%(committerdate:relative)%00%(subject)',
      ], { cwd: root, signal, allowFailure: true }),
      runGit(['remote', '-v'], { cwd: root, signal, allowFailure: true }),
      runGit(['stash', 'list', '--format=%gd%x00%s'], { cwd: root, signal, allowFailure: true }),
      runGit(['rev-parse', '--short', 'HEAD'], { cwd: root, signal, allowFailure: true }),
      runGit(['config', '--get', 'remote.origin.url'], { cwd: root, signal, allowFailure: true }),
      runGit(['config', '--get', COMMIT_PROMPT_KEY], { cwd: root, signal, allowFailure: true }),
      runGit(['config', '--get', 'user.name'], { cwd: root, signal, allowFailure: true }),
      runGit(['config', '--get', 'user.email'], { cwd: root, signal, allowFailure: true }),
      operationState(root, signal),
    ])
    const branches = parseBranches(branchesRaw.stdout)
    for (const branch of branches) {
      if (branch.kind === 'local' && branch.name === status.branch.head) branch.current = true
    }
    const remotes = parseRemotes(remotesRaw.stdout)
    const current = branches.find((branch) => branch.current) ?? null
    const url = remoteUrlRaw.code === 0 ? remoteUrlRaw.stdout.trim() : ''
    const remoteUrl = url || (remotes[0]?.url ?? '')
    const repo = {
      isRepo: true,
      root,
      name: basename(root) || root,
      branch: status.branch.head,
      detached: status.branch.detached,
      initial: status.branch.initial,
      head: headRaw.code === 0 ? headRaw.stdout.trim() : null,
      upstream: status.branch.upstream,
      upstreamGone: Boolean(current?.gone),
      ahead: status.branch.ahead,
      behind: status.branch.behind,
      remoteUrl: remoteUrl || null,
      hasRemote: remotes.length > 0,
      remoteName: remotes.some((remote) => remote.name === 'origin') ? 'origin' : (remotes[0]?.name ?? null),
    }
    const clean = (status.changes.staged.length + status.changes.unstaged.length
      + status.changes.untracked.length + status.changes.conflicted.length) === 0
    return {
      repo,
      branches,
      remotes,
      status: { clean, ...status.changes },
      stashes: parseStashes(stashRaw.stdout),
      operation: opState,
      user: {
        name: userNameRaw.code === 0 ? userNameRaw.stdout.trim() : '',
        email: userEmailRaw.code === 0 ? userEmailRaw.stdout.trim() : '',
      },
      commitPrompt: promptRaw.code === 0 ? promptRaw.stdout.trim() : '',
    }
  }

  async function graph(params, signal) {
    const cwd = assertCwd(params.cwd)
    const root = await requireRepo(cwd, signal)
    const limit = Math.min(300, Math.max(20, Number.isFinite(params.limit) ? Math.trunc(params.limit) : 120))
    const all = params.all !== false
    const args = [
      'log', '--date=relative',
      '--pretty=format:%H%x1f%P%x1f%h%x1f%an%x1f%ar%x1f%D%x1f%s',
      '-n', String(limit),
    ]
    if (all) args.push('--all')
    else args.push('HEAD')
    const result = await runGit(args, { cwd: root, signal, allowFailure: true })
    if (result.code !== 0) {
      if (/does not have any commits yet|unknown revision|bad default revision|bad revision/i.test(String(result.stderr))) {
        return { commits: [], all }
      }
      throw commandFailure(args, result)
    }
    return { commits: parseGraph(result.stdout), all }
  }

  async function commitInfo(params, signal) {
    const cwd = assertCwd(params.cwd)
    const root = await requireRepo(cwd, signal)
    const hash = assertHash(params.hash)
    const result = await runGit([
      'show', '-s', '--format=%H%x1f%h%x1f%an%x1f%ae%x1f%at%x1f%ar%x1f%D%x1f%P%x1f%B', hash,
    ], { cwd: root, signal })
    const info = parseCommitInfo(result.stdout)
    if (!info) throw new GitError('无法解析提交信息', { code: 'git-failed' })
    return info
  }

  async function diff(params, signal) {
    const cwd = assertCwd(params.cwd)
    const root = await requireRepo(cwd, signal)
    const mode = params.mode
    if (!['worktree', 'staged', 'commit', 'untracked'].includes(mode)) {
      throw new GitError(`未知的 diff 模式：${String(mode)}`, { code: 'invalid-params' })
    }
    const path = typeof params.path === 'string' && params.path !== '' ? assertRelPath(params.path) : ''
    if (mode === 'worktree' && path !== '') {
      const stages = await conflictStageHashes(root, path, signal)
      if (Object.keys(stages).length > 0) return await conflictDiff(root, path, stages, signal)
    }
    const args = []
    if (mode === 'worktree') {
      args.push('diff', '--no-color')
      if (path !== '') args.push('--', path)
    } else if (mode === 'staged') {
      args.push('diff', '--no-color', '--cached')
      if (path !== '') args.push('--', path)
    } else if (mode === 'commit') {
      const hash = assertHash(params.hash)
      args.push('show', '--no-color', '--format=', '--patch', hash)
      if (path !== '') args.push('--', path)
    } else {
      if (path === '') throw new GitError('查看未跟踪文件差异需要 path', { code: 'invalid-params' })
      args.push('diff', '--no-color', '--no-index', '--', '/dev/null', path)
    }
    const result = await runGit(args, { cwd: root, signal, allowFailure: true })
    if (result.code !== 0 && result.code !== 1) throw commandFailure(args, result)
    return finishDiff({ mode, path, raw: result.stdout })
  }

  async function conflictDiff(root, path, stages, signal) {
    const oursHash = stages[2]
    const theirsHash = stages[3]
    const base = {
      mode: 'conflict',
      path,
      conflict: true,
      oursExists: Boolean(oursHash),
      theirsExists: Boolean(theirsHash),
      files: [],
      additions: 0,
      deletions: 0,
      binary: false,
      truncated: false,
      raw: '',
    }
    if (!oursHash || !theirsHash) return base
    const result = await runGit(['diff', '--no-color', oursHash, theirsHash], {
      cwd: root, signal, allowFailure: true,
    })
    if (result.code !== 0 && result.code !== 1) throw commandFailure(['diff', oursHash, theirsHash], result)
    const parsed = finishDiff({ mode: 'conflict', path, raw: result.stdout })
    return { ...base, ...parsed, mode: 'conflict', path, conflict: true }
  }

  function finishDiff({ mode, path, raw }) {
    let text = String(raw ?? '')
    let truncated = false
    if (text.length > DIFF_MAX_CHARS) {
      text = text.slice(0, DIFF_MAX_CHARS)
      truncated = true
    }
    const parsed = parseDiff(text)
    return {
      mode,
      path,
      files: parsed.files,
      additions: parsed.additions,
      deletions: parsed.deletions,
      binary: parsed.binary,
      truncated,
      raw: text,
    }
  }

  async function stage(params, signal) {
    const cwd = assertCwd(params.cwd)
    const root = await requireRepo(cwd, signal)
    if (params.all === true) {
      const unmerged = await unmergedFiles((args, options = {}) => runGit(args, { cwd: root, signal, ...options }), signal)
      if (unmerged.length > 0) {
        throw new GitError('还有未解决冲突，不能全部暂存；请先逐个解决冲突', {
          code: 'conflict', data: { unmerged },
        })
      }
    }
    const args = params.all === true ? ['add', '-A'] : ['add', '--', ...assertPaths(params.paths)]
    const result = await runGit(args, { cwd: root, signal, timeoutMs: timeouts.write })
    return { output: joinOutput(result.stdout, result.stderr) }
  }

  async function unstage(params, signal) {
    const cwd = assertCwd(params.cwd)
    const root = await requireRepo(cwd, signal)
    const unmerged = await unmergedFiles((args, options = {}) => runGit(args, { cwd: root, signal, ...options }), signal)
    if (params.all === true && unmerged.length > 0) {
      throw new GitError('还有未解决冲突，不能全部取消暂存', { code: 'conflict', data: { unmerged } })
    }
    if (params.all !== true) {
      const paths = assertPaths(params.paths)
      if (paths.some((path) => unmerged.includes(path))) {
        throw new GitError('冲突文件不能直接取消暂存，请先用「解决冲突」处理', {
          code: 'conflict', data: { unmerged },
        })
      }
    }
    const head = await runGit(['rev-parse', '--verify', '--quiet', 'HEAD'], {
      cwd: root, signal, allowFailure: true,
    })
    let args
    if (params.all === true) {
      args = head.code === 0 ? ['reset', '-q'] : ['rm', '-r', '--cached', '--ignore-unmatch', '.']
    } else {
      const paths = assertPaths(params.paths)
      args = head.code === 0
        ? ['restore', '--staged', '--', ...paths]
        : ['rm', '--cached', '--ignore-unmatch', '--', ...paths]
    }
    const result = await runGit(args, { cwd: root, signal, timeoutMs: timeouts.write })
    return { output: joinOutput(result.stdout, result.stderr) }
  }

  async function discard(params, signal) {
    const cwd = assertCwd(params.cwd)
    const root = await requireRepo(cwd, signal)
    const mode = params.mode
    if (!['worktree', 'untracked', 'all'].includes(mode)) {
      throw new GitError(`未知的丢弃模式：${String(mode)}`, { code: 'invalid-params' })
    }
    const paths = assertPaths(params.paths)
    const unmerged = await unmergedFiles((args, options = {}) => runGit(args, { cwd: root, signal, ...options }), signal)
    if (paths.some((path) => unmerged.includes(path))) {
      throw new GitError('冲突文件不能丢弃，请先用「解决冲突」处理', { code: 'conflict', data: { unmerged } })
    }
    const head = await runGit(['rev-parse', '--verify', '--quiet', 'HEAD'], {
      cwd: root, signal, allowFailure: true,
    })
    if (mode !== 'untracked' && head.code !== 0) {
      // Unborn branch: there is no HEAD to restore from. "all" means remove the
      // staged new files; "worktree" means restore their index content.
      const outputs = []
      if (mode === 'all') {
        const removed = await runGit(['rm', '--cached', '--ignore-unmatch', '--', ...paths], {
          cwd: root, signal, timeoutMs: timeouts.write, allowFailure: true,
        })
        outputs.push(joinOutput(removed.stdout, removed.stderr))
        const cleaned = await runGit(['clean', '-f', '-d', '--', ...paths], {
          cwd: root, signal, timeoutMs: timeouts.write,
        })
        outputs.push(joinOutput(cleaned.stdout, cleaned.stderr))
      } else {
        const restored = await runGit(['checkout', '--', ...paths], {
          cwd: root, signal, timeoutMs: timeouts.write,
        })
        outputs.push(joinOutput(restored.stdout, restored.stderr))
      }
      return { output: outputs.filter(Boolean).join('\n') }
    }
    let args
    if (mode === 'untracked') args = ['clean', '-f', '-d', '--', ...paths]
    else if (mode === 'all') args = ['restore', '--staged', '--worktree', '--', ...paths]
    else args = ['restore', '--worktree', '--', ...paths]
    const result = await runGit(args, { cwd: root, signal, timeoutMs: timeouts.write })
    return { output: joinOutput(result.stdout, result.stderr) }
  }

  async function switchBranch(params, signal) {
    const cwd = assertCwd(params.cwd)
    const root = await requireRepo(cwd, signal)
    const name = assertRef(params.name, 'name')
    const localsRaw = await runGit(['for-each-ref', '--format=%(refname:short)', 'refs/heads'], {
      cwd: root, signal, allowFailure: true,
    })
    const remotesRaw = await runGit(['for-each-ref', '--format=%(refname:short)', 'refs/remotes'], {
      cwd: root, signal, allowFailure: true,
    })
    const locals = String(localsRaw.stdout).split('\n').map((line) => line.trim()).filter(Boolean)
    const remotes = String(remotesRaw.stdout).split('\n').map((line) => line.trim()).filter(Boolean)
    let args
    if (!locals.includes(name) && remotes.includes(name)) {
      const localName = name.split('/').slice(1).join('/')
      args = locals.includes(localName)
        ? ['switch', localName]
        : ['switch', '-c', localName, '--track', name]
    } else {
      args = ['switch', name]
    }
    const result = await runGit(args, { cwd: root, signal, timeoutMs: timeouts.write })
    return { branch: await currentBranch(root, signal), output: joinOutput(result.stdout, result.stderr) }
  }

  async function createBranch(params, signal) {
    const cwd = assertCwd(params.cwd)
    const root = await requireRepo(cwd, signal)
    const name = assertRef(params.name, 'name')
    const check = await runGit(['check-ref-format', '--branch', name], { cwd: root, signal, allowFailure: true })
    if (check.code !== 0) throw new GitError(`非法分支名：${name}`, { code: 'invalid-params' })
    const args = ['switch', '-c', name]
    if (typeof params.from === 'string' && params.from.trim() !== '') args.push(assertRef(params.from, 'from'))
    const result = await runGit(args, { cwd: root, signal, timeoutMs: timeouts.write })
    return { branch: await currentBranch(root, signal), output: joinOutput(result.stdout, result.stderr) }
  }

  async function deleteBranch(params, signal) {
    const cwd = assertCwd(params.cwd)
    const root = await requireRepo(cwd, signal)
    const name = assertRef(params.name, 'name')
    const branch = await currentBranch(root, signal)
    if (name === branch) throw new GitError('不能删除当前分支', { code: 'git-failed' })
    const result = await runGit(['branch', params.force === true ? '-D' : '-d', name], {
      cwd: root, signal, timeoutMs: timeouts.write,
    })
    return { output: joinOutput(result.stdout, result.stderr) }
  }

  async function commit(params, signal) {
    const cwd = assertCwd(params.cwd)
    const root = await requireRepo(cwd, signal)
    const message = typeof params.message === 'string' ? params.message.trim() : ''
    if (message === '') throw new GitError('提交信息不能为空', { code: 'invalid-params' })
    if (message.length > 5000) throw new GitError('提交信息过长（上限 5000 字）', { code: 'invalid-params' })
    const unmerged = await unmergedFiles((args, options = {}) => runGit(args, { cwd: root, signal, ...options }), signal)
    if (unmerged.length > 0) {
      throw new GitError(`还有 ${unmerged.length} 个文件存在冲突，解决后才能提交`, {
        code: 'conflict', data: { unmerged },
      })
    }
    const explicitPaths = params.paths === undefined ? null : [...new Set(assertPaths(params.paths))]
    const excludePaths = params.exclude === undefined ? [] : [...new Set(assertPaths(params.exclude))]
    if (explicitPaths !== null) {
      if (explicitPaths.length === 0) {
        throw new GitError('没有选中任何改动', { code: 'nothing-to-commit' })
      }
      await runGit(['add', '-A', '--', ...explicitPaths], {
        cwd: root, signal, timeoutMs: timeouts.write,
      })
      if (excludePaths.length > 0) {
        const head = await runGit(['rev-parse', '--verify', '--quiet', 'HEAD'], {
          cwd: root, signal, allowFailure: true,
        })
        const args = head.code === 0
          ? ['restore', '--staged', '--', ...excludePaths]
          : ['rm', '--cached', '--ignore-unmatch', '--', ...excludePaths]
        await runGit(args, { cwd: root, signal, timeoutMs: timeouts.write, allowFailure: true })
      }
    } else if (params.autoStage !== false) {
      await runGit(['add', '-A'], { cwd: root, signal, timeoutMs: timeouts.write })
    }
    const staged = await runGit(['diff', '--cached', '--name-only', '-z'], {
      cwd: root, signal, allowFailure: true,
    })
    if (String(staged.stdout ?? '').split('\0').filter(Boolean).length === 0) {
      throw new GitError('没有可提交的改动', { code: 'nothing-to-commit' })
    }
    const result = await runGit(['commit', '-m', message], {
      cwd: root, signal, timeoutMs: timeouts.write,
    })
    const hashResult = await runGit(['rev-parse', '--short', 'HEAD'], { cwd: root, signal, allowFailure: true })
    const subjectResult = await runGit(['log', '-1', '--pretty=format:%s'], { cwd: root, signal, allowFailure: true })
    return {
      hash: hashResult.code === 0 ? hashResult.stdout.trim() : null,
      subject: subjectResult.code === 0 ? subjectResult.stdout.trim() : message,
      branch: await currentBranch(root, signal),
      output: joinOutput(result.stdout, result.stderr),
    }
  }

  async function fetchRemote(params, signal) {
    const cwd = assertCwd(params.cwd)
    const root = await requireRepo(cwd, signal)
    const args = typeof params.remote === 'string' && params.remote !== ''
      ? ['fetch', assertRef(params.remote, 'remote'), '--prune']
      : ['fetch', '--all', '--prune']
    const result = await runGit(args, { cwd: root, signal, timeoutMs: timeouts.network })
    return { output: joinOutput(result.stdout, result.stderr), at: Date.now() }
  }

  function makeRunner(root, signal) {
    return (args, options = {}) => runGit(args, {
      cwd: root,
      signal,
      allowFailure: options.allowFailure,
      timeoutMs: options.timeoutMs ?? timeouts.write,
    })
  }

  async function sync(params, signal) {
    const cwd = assertCwd(params.cwd)
    const root = await requireRepo(cwd, signal)
    const mode = params.mode === 'pull' || params.mode === 'push' ? params.mode : 'sync'
    const remote = typeof params.remote === 'string' && params.remote !== ''
      ? assertRef(params.remote, 'remote')
      : undefined
    const branch = typeof params.branch === 'string' && params.branch !== ''
      ? assertRef(params.branch, 'branch')
      : undefined
    try {
      return await integrate({
        run: makeRunner(root, signal),
        mode,
        cwd: root,
        remote,
        branch,
        autoStash: params.autoStash !== false,
        signal,
      })
    } catch (error) {
      if (error instanceof GitError) throw error
      const message = error?.message ?? String(error)
      const code = /没有配置远端/.test(message) ? 'no-remote'
        : /游离 HEAD/.test(message) ? 'detached'
          : /未提交的改动/.test(message) ? 'dirty'
            : 'git-failed'
      throw new GitError(message, { code })
    }
  }

  async function push(params, signal) {
    return sync({ ...params, mode: 'push' }, signal)
  }

  async function pull(params, signal) {
    return sync({ ...params, mode: 'pull' }, signal)
  }

  function assertStashIndex(value) {
    const index = value === undefined || value === null ? 0 : Number(value)
    if (!Number.isInteger(index) || index < 0 || index > 999) {
      throw new GitError(`stash 索引非法：${String(value)}`, { code: 'invalid-params' })
    }
    return index
  }

  async function stashPush(params, signal) {
    const cwd = assertCwd(params.cwd)
    const root = await requireRepo(cwd, signal)
    const args = ['stash', 'push']
    if (params.includeUntracked !== false) args.push('-u')
    const message = typeof params.message === 'string' ? params.message.trim().slice(0, 200) : ''
    if (message !== '') args.push('-m', message)
    const result = await runGit(args, { cwd: root, signal, timeoutMs: timeouts.write })
    return { output: joinOutput(result.stdout, result.stderr) }
  }

  async function stashPop(params, signal) {
    const cwd = assertCwd(params.cwd)
    const root = await requireRepo(cwd, signal)
    const index = assertStashIndex(params.index)
    const result = await runGit(['stash', 'pop', `stash@{${index}}`], {
      cwd: root, signal, timeoutMs: timeouts.write,
    })
    return { output: joinOutput(result.stdout, result.stderr) }
  }

  async function stashDrop(params, signal) {
    const cwd = assertCwd(params.cwd)
    const root = await requireRepo(cwd, signal)
    const index = assertStashIndex(params.index)
    const result = await runGit(['stash', 'drop', `stash@{${index}}`], {
      cwd: root, signal, timeoutMs: timeouts.write,
    })
    return { output: joinOutput(result.stdout, result.stderr) }
  }

  async function setCommitPrompt(params, signal) {
    const cwd = assertCwd(params.cwd)
    const root = await requireRepo(cwd, signal)
    const raw = typeof params.prompt === 'string' ? params.prompt : ''
    if (raw.length > COMMIT_PROMPT_MAX) {
      throw new GitError(`提示词过长（上限 ${COMMIT_PROMPT_MAX} 字）`, { code: 'invalid-params' })
    }
    const value = raw.trim()
    if (value === '') {
      await runGit(['config', '--local', '--unset', COMMIT_PROMPT_KEY], {
        cwd: root, signal, timeoutMs: timeouts.write, allowFailure: true,
      })
    } else {
      await runGit(['config', '--local', COMMIT_PROMPT_KEY, value], {
        cwd: root, signal, timeoutMs: timeouts.write,
      })
    }
    const read = await runGit(['config', '--get', COMMIT_PROMPT_KEY], { cwd: root, signal, allowFailure: true })
    return { prompt: read.code === 0 ? read.stdout.trim() : '' }
  }

  async function models(params, signal) {
    const context = services()
    const llm = context.llm
    if (!llm) return { groups: [], failures: [], unavailable: true, default: null }
    if (catalogCache === null || params.force === true || Date.now() - catalogCache.at > 60000) {
      catalogCache = { at: Date.now(), value: await readModelCatalog(llm) }
    }
    const catalog = catalogCache.value
    let selection = null
    const sessionId = typeof params.sessionId === 'string' ? params.sessionId : ''
    if (sessionId && context.sessions) {
      try {
        const session = context.sessions.get(sessionId)
        const header = session?.requestHeader?.()
        if (header?.config?.provider && header?.config?.model) {
          selection = {
            provider: header.config.provider,
            model: header.config.model,
            reasoningEffort: header.config.reasoningEffort,
          }
        }
      } catch {
        selection = null
      }
    }
    if (!selection) {
      try {
        selection = context.defaultModel?.currentSelection?.() ?? null
      } catch {
        selection = null
      }
    }
    let resolvedDefault = null
    if (selection?.provider && selection?.model) {
      for (const group of catalog.groups) {
        if (group.id !== selection.provider) continue
        const model = group.models.find((entry) => entry.id === selection.model)
        if (!model) continue
        const efforts = model.reasoning?.efforts?.map((effort) => effort.id) ?? []
        const effort = chooseLowEffort(efforts)
        resolvedDefault = {
          provider: selection.provider,
          model: selection.model,
          reasoningEffort: effort ?? null,
          label: `${selection.provider}/${selection.model}`,
          modelName: model.name,
          efforts,
        }
        break
      }
    }
    return {
      groups: catalog.groups,
      failures: catalog.failures,
      unavailable: false,
      default: resolvedDefault,
      sessionId: sessionId || null,
    }
  }

  async function selectionFor(params, signal) {
    const context = services()
    const llm = context.llm
    if (!llm) throw new GitError('AI 服务不可用', { code: 'ai-unavailable' })
    let sessionSelection = null
    const sessionId = typeof params.sessionId === 'string' ? params.sessionId : ''
    if (sessionId && context.sessions) {
      try {
        const header = context.sessions.get(sessionId)?.requestHeader?.()
        if (header?.config?.provider && header?.config?.model) {
          sessionSelection = {
            provider: header.config.provider,
            model: header.config.model,
            reasoningEffort: header.config.reasoningEffort,
          }
        }
      } catch {
        sessionSelection = null
      }
    }
    if (!sessionSelection) {
      try {
        sessionSelection = context.defaultModel?.currentSelection?.() ?? null
      } catch {
        sessionSelection = null
      }
    }
    const explicit = params.selection && typeof params.selection === 'object'
      ? params.selection
      : (params.provider && params.model ? { provider: params.provider, model: params.model } : null)
    const effortPreference = typeof params.effort === 'string' ? params.effort : 'auto'
    let warning = ''
    if (explicit?.provider && explicit?.model) {
      try {
        const resolved = await resolveModelSelection({
          llm, explicit, effortPreference, fallback: sessionSelection,
        })
        return { llm, selection: resolved, warning }
      } catch (error) {
        warning = `所选模型不可用，已改用当前会话模型：${brief(error?.message ?? error, 300)}`
      }
    }
    const resolved = await resolveModelSelection({
      llm, fallback: sessionSelection, effortPreference,
    })
    return { llm, selection: resolved, warning }
  }

  async function aiCommit(params, signal) {
    const cwd = assertCwd(params.cwd)
    const root = await requireRepo(cwd, signal)
    const hint = typeof params.hint === 'string' ? params.hint.slice(0, 500) : ''
    const selectedPaths = params.paths === undefined ? null : assertPaths(params.paths)
    const promptRaw = await runGit(['config', '--get', COMMIT_PROMPT_KEY], {
      cwd: root, signal, allowFailure: true,
    })
    const branch = await currentBranch(root, signal)
    try {
      const resolved = await selectionFor(params, signal)
      const shouldStage = params.stageFirst === true
      if (shouldStage) await runGit(['add', '-A'], { cwd: root, signal, timeoutMs: timeouts.write })
      const result = await draftCommitMessage({
        runGit: (args, options = {}) => runGit(args, { cwd: root, signal, timeoutMs: timeouts.read, ...options }),
        cwd: root,
        llm: resolved.llm,
        selection: resolved.selection,
        hint,
        branch,
        paths: selectedPaths || undefined,
        customPrompt: promptRaw.code === 0 ? promptRaw.stdout : '',
        signal,
      })
      const warning = [resolved.warning, result.warning].filter(Boolean).join('；')
      return { ...result, effort: resolved.selection.reasoningEffort ?? null, warning }
    } catch (error) {
      if (error?.code !== 'ai-unavailable') throw error
      const status = await readStatus(root, signal)
      const files = new Set([
        ...status.changes.staged.map((entry) => entry.path),
        ...status.changes.unstaged.map((entry) => entry.path),
        ...status.changes.untracked.map((entry) => entry.path),
      ]).size
      const chinese = await hasChineseHistory(root, signal)
      const subject = chinese
        ? (files === 0 ? 'chore: 无文件变更' : `chore: 更新 ${files} 个文件`)
        : (files === 0 ? 'chore: no file changes' : `chore: update ${files} file${files === 1 ? '' : 's'}`)
      return {
        subject,
        body: '',
        message: subject,
        model: null,
        fallback: true,
        truncated: false,
        attempts: 0,
        effort: null,
        warning: `AI 不可用，已生成降级文案：${brief(error?.message ?? error, 300)}`,
      }
    }
  }

  async function hasChineseHistory(root, signal) {
    const result = await runGit(['log', '-8', '--pretty=format:%s'], { cwd: root, signal, allowFailure: true })
    const joined = String(result.stdout ?? '')
    if (!joined) return false
    const cjk = (joined.match(/[\u3400-\u9fff]/g) ?? []).length
    return cjk >= Math.max(1, Math.floor(joined.length * 0.2))
  }

  async function conflictInfo(params, signal) {
    const cwd = assertCwd(params.cwd)
    const root = await requireRepo(cwd, signal)
    const path = assertRelPath(params.path)
    const info = await loadConflict(root, path, signal)
    return {
      path,
      branch: await currentBranch(root, signal),
      incoming: await incomingRef(root, signal),
      hasBase: info.base !== null,
      oursExists: Boolean(info.stages[2]),
      theirsExists: Boolean(info.stages[3]),
      ours: info.ours.slice(0, DIFF_MAX_CHARS),
      theirs: info.theirs.slice(0, DIFF_MAX_CHARS),
      base: (info.base ?? '').slice(0, DIFF_MAX_CHARS),
    }
  }

  async function aiResolve(params, signal) {
    const cwd = assertCwd(params.cwd)
    const root = await requireRepo(cwd, signal)
    const path = assertRelPath(params.path)
    const apply = params.apply === true
    const hint = typeof params.hint === 'string' ? params.hint.slice(0, 500) : ''
    const info = await loadConflict(root, path, signal)
    const oursDeleted = !info.stages[2]
    const theirsDeleted = !info.stages[3]
    const hasBase = info.base !== null
    const unchanged = (text) => hasBase && text === info.base
    const deleteOnly = (oursDeleted && theirsDeleted)
      || (theirsDeleted && unchanged(info.ours))
      || (oursDeleted && unchanged(info.theirs))
    if (deleteOnly) {
      if (apply) {
        await deleteConflictFile(root, path, signal)
        return {
          path, resolved: true, deleted: true, deterministic: true, model: null, route: 'deterministic',
          unmerged: await unmergedCount(root, signal),
        }
      }
      return {
        path, suggested: null, delete: true, deterministic: true, model: null,
        hasBase, oursExists: !oursDeleted, theirsExists: !theirsDeleted,
      }
    }
    let merged = ''
    try {
      merged = await readFile(join(root, path), 'utf8')
    } catch {
      merged = ''
    }
    const resolved = await selectionFor(params, signal)
    const result = await suggestConflictResolution({
      llm: resolved.llm,
      selection: resolved.selection,
      path,
      base: info.base,
      ours: info.ours,
      theirs: info.theirs,
      merged,
      oursDeleted,
      theirsDeleted,
      branch: await currentBranch(root, signal),
      incoming: await incomingRef(root, signal),
      hint,
      signal,
    })
    if (apply) {
      if (result.delete) {
        await deleteConflictFile(root, path, signal)
        return {
          path, resolved: true, deleted: true, deterministic: false, model: result.model,
          route: result.route ?? 'whole',
          ...(result.hunks === undefined ? {} : { hunks: result.hunks }), warning: resolved.warning,
          unmerged: await unmergedCount(root, signal),
        }
      }
      await writeResolution(root, path, result.content, signal)
      return {
        path, resolved: true, deleted: false, deterministic: false, model: result.model,
        route: result.route ?? 'whole',
        ...(result.hunks === undefined ? {} : { hunks: result.hunks }), warning: resolved.warning,
        unmerged: await unmergedCount(root, signal),
      }
    }
    return {
      path,
      suggested: result.content,
      delete: result.delete,
      deterministic: false,
      model: result.model,
      route: result.route ?? 'whole',
      ...(result.hunks === undefined ? {} : { hunks: result.hunks }),
      hasBase,
      oursExists: !oursDeleted,
      theirsExists: !theirsDeleted,
      warning: resolved.warning,
    }
  }

  async function deleteConflictFile(root, path, signal) {
    await runGit(['rm', '-f', '--ignore-unmatch', '--', path], {
      cwd: root, signal, timeoutMs: timeouts.write, allowFailure: true,
    })
  }

  async function writeResolution(root, path, content, signal) {
    if (typeof content !== 'string' || content.trim() === '') {
      throw new GitError('content 不能为空', { code: 'invalid-params' })
    }
    if (content.length > DIFF_MAX_CHARS) {
      throw new GitError(`content 过长（${content.length} 字符）`, { code: 'invalid-params' })
    }
    if (hasConflictMarkers(content)) {
      throw new GitError('解决结果仍包含冲突标记，拒绝写入', { code: 'invalid-params' })
    }
    const absolute = join(root, path)
    const rel = relative(root, absolute)
    if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
      throw new GitError('path 超出仓库范围', { code: 'invalid-params' })
    }
    await writeFileImpl(absolute, content, 'utf8')
    await runGit(['add', '--', path], { cwd: root, signal, timeoutMs: timeouts.write })
  }

  async function applyResolution(params, signal) {
    const cwd = assertCwd(params.cwd)
    const root = await requireRepo(cwd, signal)
    const path = assertRelPath(params.path)
    await loadConflict(root, path, signal)
    if (params.delete === true) {
      await deleteConflictFile(root, path, signal)
      return { path, resolved: true, deleted: true, unmerged: await unmergedCount(root, signal) }
    }
    await writeResolution(root, path, params.content, signal)
    return { path, resolved: true, deleted: false, unmerged: await unmergedCount(root, signal) }
  }

  async function unmergedCount(root, signal) {
    return (await unmergedFiles(makeRunner(root, signal), signal)).length
  }

  async function markResolved(params, signal) {
    const cwd = assertCwd(params.cwd)
    const root = await requireRepo(cwd, signal)
    const path = assertRelPath(params.path)
    await loadConflict(root, path, signal)
    const absolute = join(root, path)
    const rel = relative(root, absolute)
    if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
      throw new GitError('path 超出仓库范围', { code: 'invalid-params' })
    }
    let content = null
    try {
      content = await readFile(absolute, 'utf8')
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        throw new GitError(`无法读取冲突文件：${brief(error?.message ?? error, 400)}`, { code: 'internal' })
      }
      content = null
    }
    if (content !== null && hasConflictMarkers(content)) {
      throw new GitError('文件里仍有冲突标记，请先清理后再标记为已解决', { code: 'invalid-params' })
    }
    await runGit(['add', '--', path], { cwd: root, signal, timeoutMs: timeouts.write })
    return { path, resolved: true, deleted: content === null, unmerged: await unmergedCount(root, signal) }
  }

  async function takeSide(params, signal) {
    const cwd = assertCwd(params.cwd)
    const root = await requireRepo(cwd, signal)
    const path = assertRelPath(params.path)
    const side = params.side
    if (side !== 'ours' && side !== 'theirs') {
      throw new GitError(`side 只能是 ours 或 theirs：${String(side)}`, { code: 'invalid-params' })
    }
    const info = await loadConflict(root, path, signal)
    const deleted = !info.stages[side === 'ours' ? 2 : 3]
    if (deleted) {
      await runGit(['rm', '-f', '--ignore-unmatch', '--', path], {
        cwd: root, signal, timeoutMs: timeouts.write, allowFailure: true,
      })
    } else {
      await runGit(['checkout', side === 'ours' ? '--ours' : '--theirs', '--', path], {
        cwd: root, signal, timeoutMs: timeouts.write,
      })
      await runGit(['add', '--', path], { cwd: root, signal, timeoutMs: timeouts.write })
    }
    return { path, side, deleted, resolved: true, unmerged: await unmergedCount(root, signal) }
  }

  async function abortOperation(params, signal) {
    const cwd = assertCwd(params.cwd)
    const root = await requireRepo(cwd, signal)
    const op = await operationState(root, signal)
    const commands = []
    if (op.merge) commands.push(['merge', '--abort'])
    if (op.rebase) commands.push(['rebase', '--abort'])
    if (op.cherryPick) commands.push(['cherry-pick', '--abort'])
    if (op.revert) commands.push(['revert', '--abort'])
    if (commands.length === 0) throw new GitError('当前没有进行中的合并或变基', { code: 'invalid-params' })
    const outputs = []
    for (const args of commands) {
      const result = await runGit(args, { cwd: root, signal, timeoutMs: timeouts.write, allowFailure: true })
      outputs.push(joinOutput(result.stdout, result.stderr))
      if (result.code !== 0) throw commandFailure(args, result)
    }
    return { output: outputs.filter(Boolean).join('\n'), operation: await operationState(root, signal) }
  }

  async function continueOperation(params, signal) {
    const cwd = assertCwd(params.cwd)
    const root = await requireRepo(cwd, signal)
    const op = await operationState(root, signal)
    if (op.conflicted > 0) {
      throw new GitError(`还有 ${op.conflicted} 个冲突文件未解决`, { code: 'conflict' })
    }
    let args = null
    if (op.rebase) args = ['-c', 'core.editor=true', 'rebase', '--continue']
    else if (op.cherryPick) args = ['-c', 'core.editor=true', 'cherry-pick', '--continue']
    else if (op.revert) args = ['-c', 'core.editor=true', 'revert', '--continue']
    else if (op.merge) args = ['-c', 'core.editor=true', 'commit', '--no-edit']
    if (!args) throw new GitError('当前没有可继续的操作', { code: 'invalid-params' })
    const result = await runGit(args, { cwd: root, signal, timeoutMs: timeouts.write, allowFailure: true })
    if (result.code !== 0) throw commandFailure(args, result)
    return { output: joinOutput(result.stdout, result.stderr), operation: await operationState(root, signal) }
  }

  const handlers = {
    snapshot, graph, commitInfo, diff,
    stage, unstage, discard,
    switchBranch, createBranch, deleteBranch,
    commit, fetch: fetchRemote, pull, push, sync,
    stashPush, stashPop, stashDrop,
    aiCommit, models, setCommitPrompt,
    conflictInfo, aiResolve, applyResolution, takeSide, markResolved,
    abortOperation, continueOperation,
  }

  /**
   * Dispatch one RPC request.
   * @param {string} op
   * @param {Record<string, unknown>} params
   * @param {AbortSignal} [outerSignal]
   */
  async function handle(op, params, outerSignal) {
    if (typeof op !== 'string' || !OPS.includes(op)) {
      throw new GitError(`未知操作：${String(op)}`, { code: 'invalid-params' })
    }
    if (params === null || typeof params !== 'object' || Array.isArray(params)) {
      throw new GitError('参数必须是 JSON 对象', { code: 'invalid-params' })
    }
    const timeout = op === 'sync' || op === 'pull' || op === 'push'
      ? timeouts.sync
      : op === 'fetch'
        ? timeouts.network
        : op === 'aiCommit'
          ? timeouts.ai
          : op === 'aiResolve'
            ? timeouts.resolveAi
            : op === 'stage' || op === 'unstage' || op === 'discard' || op === 'commit'
            || op === 'switchBranch' || op === 'createBranch' || op === 'deleteBranch'
            || op === 'stashPush' || op === 'stashPop' || op === 'stashDrop'
            || op === 'applyResolution' || op === 'takeSide' || op === 'markResolved'
            || op === 'abortOperation' || op === 'continueOperation' || op === 'setCommitPrompt'
            ? timeouts.write
            : timeouts.read
    const controller = new AbortController()
    const onAbort = () => controller.abort()
    if (outerSignal) {
      if (outerSignal.aborted) controller.abort()
      else outerSignal.addEventListener('abort', onAbort, { once: true })
    }
    const timer = setTimeout(() => controller.abort(), timeout)
    try {
      return await handlers[op](params, controller.signal)
    } catch (error) {
      if (error instanceof GitError) throw error
      if (controller.signal.aborted) {
        throw new GitError(`git ${op} 超时（${timeout}ms）或被取消`, { code: 'timeout' })
      }
      throw new GitError(`git ${op} 失败：${brief(error?.message ?? error, 800)}`, { code: 'internal' })
    } finally {
      clearTimeout(timer)
      if (outerSignal) outerSignal.removeEventListener('abort', onAbort)
    }
  }

  return { handle, ops: [...OPS], runGit }
}