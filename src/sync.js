/**
 * Frictionless integration engine.
 *
 * The panel exposes one primary action (Sync). Behind the scenes this module
 * fetches, establishes a missing upstream, fast-forwards or merges remote work,
 * auto-stashes local edits, and pushes — retrying once when the remote moved
 * while we were working. It never force-pushes and never rewrites history.
 */
import { commandFailure, brief } from './git.js'

const AUTO_STASH_MESSAGE = 'wdx-git: auto-stash before sync'

/** The commit id of the newest stash entry, so the panel can find it later. */
async function newestStashHash(run, signal) {
  const ref = await run(['rev-parse', '--verify', '--quiet', 'refs/stash'], { allowFailure: true, signal })
  return ref.code === 0 ? ref.stdout.trim() : ''
}

/** Network-ish failures get a longer timeout than ordinary writes. */
export const NETWORK_TIMEOUT = 240000

/**
 * @typedef {(args: string[], options?: {allowFailure?: boolean, timeoutMs?: number, signal?: AbortSignal}) => Promise<{code: number|null, stdout: string, stderr: string}>} Runner
 */

/**
 * Run one sync / pull / push operation.
 *
 * @param {{
 *   run: Runner,
 *   mode: 'sync' | 'pull' | 'push',
 *   cwd: string,
 *   remote?: string,
 *   branch?: string,
 *   autoStash?: boolean,
 *   signal?: AbortSignal,
 * }} options
 */
export async function integrate(options) {
  const { run, mode, cwd, signal } = options
  const steps = []
  const note = (id, detail) => steps.push({ id, detail: detail || '' })
  let stashRestoreFailed = false
  let pendingStashHash = null

  const branchResult = await run(['rev-parse', '--abbrev-ref', 'HEAD'], { allowFailure: true, signal })
  let branch = branchResult.code === 0 ? branchResult.stdout.trim() : ''
  if (!branch || branch === 'HEAD') {
    const symbolic = await run(['symbolic-ref', '--short', 'HEAD'], { allowFailure: true, signal })
    branch = symbolic.code === 0 ? symbolic.stdout.trim() : ''
  }
  if (!branch || branch === 'HEAD') {
    throw new Error('当前是游离 HEAD，无法同步。请先切换到一个分支。')
  }
  const remotes = await listRemotes(run, signal)
  if (remotes.length === 0) {
    throw new Error('这个仓库还没有配置远端（remote），所以无法同步。请先添加 origin。')
  }
  const remote = options.remote ?? (remotes.includes('origin') ? 'origin' : remotes[0])

  // Push-only path: try first, then repair a stale remote with one merge retry.
  if (mode === 'push') {
    return await pushWithRetry({ run, cwd, branch, remote, steps, note, signal })
  }

  // If the branch already tracks a non-default remote, fetch that remote so the
  // behind/ahead calculation is meaningful for multi-remote repositories.
  const tracked = await run(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'], {
    allowFailure: true,
    signal,
  })
  const trackedRef = tracked.code === 0 ? tracked.stdout.trim() : ''
  const trackedRemote = remoteOfRef(trackedRef)
  const fetchRemote = options.remote ?? (trackedRemote || remote)
  const fetch = await run(['fetch', fetchRemote, '--prune'], { allowFailure: true, timeoutMs: NETWORK_TIMEOUT, signal })
  if (fetch.code !== 0) throw commandFailure(['fetch', fetchRemote, '--prune'], fetch)
  note('fetch', brief(fetch.stderr, 400))

  let upstream = await resolveUpstream(run, cwd, branch, remote, signal)
  if (!upstream.hasUpstream) {
    note('upstream', upstream.remoteRefExists ? `已设置上游 ${upstream.remoteRef}` : '远端尚无同名分支')
  }

  let { ahead, behind } = await trackingCounts(run, upstream, signal)
  let mergedKind = null
  if (behind > 0) {
    const result = await integrateRemote({
      run,
      cwd,
      upstream: upstream.hasUpstream ? upstream.upstreamRef : upstream.remoteRef,
      autoStash: options.autoStash !== false,
      signal,
      note,
    })
    if (result.conflict) {
      const after = await trackingCounts(run, upstream, signal)
      return {
        mode,
        branch,
        remote: fetchRemote,
        upstream: upstream.hasUpstream ? upstream.upstreamRef : null,
        ahead: after.ahead,
        behind: after.behind,
        hasUpstream: upstream.hasUpstream,
        merged: null,
        pushed: false,
        stashed: result.stashed,
        conflict: true,
        conflictFiles: result.conflictFiles,
        stashHash: result.stashHash ?? null,
        stashRestoreConflict: !!result.stashRestoreConflict,
        stashRestoreFailed: !!result.stashRestoreFailed,
        steps,
        output: result.output,
      }
    }
    mergedKind = result.merged
    if (result.stashRestoreFailed) {
      stashRestoreFailed = true
      pendingStashHash = result.stashHash ?? null
    }
    ;({ ahead, behind } = await trackingCounts(run, upstream, signal))
  }

  const headCheck = await run(['rev-parse', '--verify', '--quiet', 'HEAD'], { allowFailure: true, signal })
  const hasHead = headCheck.code === 0
  let pushed = false
  if (mode === 'sync' && (ahead > 0 || (!upstream.hasUpstream && hasHead))) {
    const pushResult = await pushWithRetry({ run, cwd, branch, remote, steps, note, signal })
    pushed = pushResult.pushed
    if (pushResult.conflict) return { ...pushResult, mode, merged: mergedKind }
    ahead = 0
    behind = 0
  }

  const currentUpstream = await resolveUpstream(run, cwd, branch, remote, signal)
  const final = await trackingCounts(run, currentUpstream, signal)
  return {
    mode,
    branch,
    remote: fetchRemote,
    upstream: currentUpstream.upstreamRef || upstream.upstreamRef || upstream.remoteRef,
    ahead: final.ahead,
    behind: final.behind,
    hasUpstream: currentUpstream.hasUpstream,
    merged: mergedKind,
    pushed,
    stashed: steps.some((step) => step.id === 'stash'),
    conflict: false,
    conflictFiles: [],
    stashHash: pendingStashHash,
    stashRestoreConflict: false,
    stashRestoreFailed,
    steps,
    output: steps.map((step) => step.detail).filter(Boolean).join('\n'),
  }
}

/** Resolve (or establish) the current branch's upstream. */
async function resolveUpstream(run, cwd, branch, remote, signal) {
  const tracked = await run(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'], {
    allowFailure: true,
    signal,
  })
  let upstreamRef = tracked.code === 0 ? tracked.stdout.trim() : ''
  if (upstreamRef !== '') {
    const exists = await run(['rev-parse', '--verify', '--quiet', upstreamRef], { allowFailure: true, signal })
    if (exists.code !== 0) upstreamRef = ''
  }
  const remoteRef = `${remote}/${branch}`
  const remoteRefExists = (await run(['rev-parse', '--verify', '--quiet', `refs/remotes/${remoteRef}`], {
    allowFailure: true,
    signal,
  })).code === 0
  if (upstreamRef === '' && remoteRefExists) {
    const set = await run(['branch', `--set-upstream-to=${remoteRef}`, branch], { allowFailure: true, signal })
    if (set.code === 0) upstreamRef = remoteRef
  }
  return {
    hasUpstream: upstreamRef !== '',
    upstreamRef,
    upstreamRemote: remoteOfRef(upstreamRef) || remote,
    remoteRef,
    remoteRefExists,
    remote,
    branch,
  }
}

/** Read ahead/behind without failing when no upstream exists. */
async function trackingCounts(run, upstream, signal) {
  if (!upstream.hasUpstream) {
    const ahead = await run(['rev-list', '--count', 'HEAD'], { allowFailure: true, signal })
    return { ahead: ahead.code === 0 ? Number(ahead.stdout.trim() || 0) : 0, behind: 0 }
  }
  const counts = await run(['rev-list', '--left-right', '--count', `HEAD...${upstream.upstreamRef}`], {
    allowFailure: true,
    signal,
  })
  if (counts.code !== 0) return { ahead: 0, behind: 0 }
  const [ahead, behind] = counts.stdout.trim().split(/\s+/).map(Number)
  return { ahead: Number.isFinite(ahead) ? ahead : 0, behind: Number.isFinite(behind) ? behind : 0 }
}

/** Merge remote work, optionally parking local edits in a stash first. */
async function integrateRemote({ run, cwd, upstream, autoStash, signal, note }) {
  const status = await run(['status', '--porcelain=v2', '-z', '--untracked-files=all'], { allowFailure: true, signal })
  const dirty = status.code === 0 && status.stdout !== ''
  let stashed = false
  let stashHash = ''
  let output = ''
  if (dirty && autoStash) {
    const stash = await run(['stash', 'push', '-u', '-m', AUTO_STASH_MESSAGE], {
      allowFailure: true,
      timeoutMs: 120000,
      signal,
    })
    if (stash.code !== 0) throw commandFailure(['stash', 'push', '-u'], stash)
    stashed = true
    stashHash = await newestStashHash(run, signal)
    note('stash', '本地改动已暂存到 stash')
    output += `${stash.stdout}\n`
  } else if (dirty) {
    throw new Error('工作区有未提交的改动，自动 stash 已关闭，无法安全合并远端提交。')
  }

  const fastForward = await run(['merge', '--ff-only', upstream], { allowFailure: true, timeoutMs: 120000, signal })
  let merged = null
  if (fastForward.code === 0) {
    merged = 'fast-forward'
    note('merge', '快进合并完成')
    output += `${fastForward.stdout}\n`
  } else {
    // Override a repository that forces ff-only merges: Sync is explicitly a
    // "merge when needed" action, and the ff-only attempt above already ran.
    const mergedResult = await run(['-c', 'merge.ff=false', 'merge', '--no-edit', upstream], {
      allowFailure: true,
      timeoutMs: 120000,
      signal,
    })
    output += `${mergedResult.stdout}\n${mergedResult.stderr}\n`
    if (mergedResult.code !== 0) {
      const conflictFiles = await unmergedFiles(run, signal)
      if (conflictFiles.length > 0) {
        // The stash stays parked; the panel restores it once the merge commit
        // for this conflict resolution exists.
        return { conflict: true, conflictFiles, stashed, stashHash, merged: null, output }
      }
      await run(['merge', '--abort'], { allowFailure: true, signal })
      if (stashed) await run(['stash', 'pop'], { allowFailure: true, signal })
      throw commandFailure(['merge', '--no-edit', upstream], mergedResult)
    }
    merged = 'merge'
    note('merge', '已创建合并提交')
  }

  if (stashed) {
    const pop = await run(['stash', 'pop'], { allowFailure: true, timeoutMs: 120000, signal })
    output += `${pop.stdout}\n${pop.stderr}\n`
    if (pop.code !== 0) {
      const conflictFiles = await unmergedFiles(run, signal)
      if (conflictFiles.length > 0) {
        return {
          conflict: true,
          conflictFiles,
          stashed: true,
          stashHash,
          stashRestoreConflict: true,
          merged,
          output,
        }
      }
      // No unmerged entries: the restore failed for another reason (a file
      // collision, a lock, ...). Keep the stash and surface it as a warning
      // instead of pretending this was a conflict or a clean sync.
      note('stash-restore-failed', '本地改动未能自动恢复，仍保存在 stash')
      return {
        conflict: false,
        conflictFiles: [],
        stashed: true,
        stashHash,
        stashRestoreFailed: true,
        merged,
        output,
      }
    }
    note('stash-restore', '草稿改动已恢复')
  }
  return { conflict: false, merged, stashed, stashHash: null, conflictFiles: [], output }
}

/**
 * Push, and when the remote moved on, fetch + merge + retry. A single retry is
 * not enough on a busy branch (two pushes can land while we merge), so keep
 * going up to a small bound instead of failing on the second rejection.
 */
const PUSH_ATTEMPTS = 4

async function pushWithRetry({ run, cwd, branch, remote, steps, note, signal }) {
  let upstream = await resolveUpstream(run, cwd, branch, remote, signal)
  const fetchRemote = upstream.upstreamRemote || remote
  let mergeKind = null
  let stashRestoreFailed = false
  let pendingStashHash = null
  let result = null
  for (let attempt = 0; attempt < PUSH_ATTEMPTS; attempt += 1) {
    result = await pushOnce(run, cwd, branch, upstream, signal)
    if (result.code === 0) {
      note('push', brief(result.stderr, 400))
      const tags = await pushTags(run, signal)
      if (tags && tags.code !== 0) note('tags', brief(tags.stderr || tags.stdout, 400))
      const final = await resolveUpstream(run, cwd, branch, remote, signal)
      return {
        mode: 'push',
        branch,
        remote: fetchRemote,
        upstream: final.upstreamRef || null,
        ahead: 0,
        behind: 0,
        hasUpstream: final.hasUpstream,
        merged: mergeKind,
        pushed: true,
        stashed: false,
        conflict: false,
        conflictFiles: [],
        stashHash: pendingStashHash,
        stashRestoreConflict: false,
        stashRestoreFailed,
        steps,
        output: result.stderr,
      }
    }
    if (!isRejectedPush(result)) throw commandFailure(['push'], result)
    if (attempt === PUSH_ATTEMPTS - 1) break

    note('push-retry', attempt === 0
      ? '远端有新提交，先合并再推送'
      : '远端又更新了，继续合并后重试推送')
    const fetch = await run(['fetch', fetchRemote, '--prune'], { allowFailure: true, timeoutMs: NETWORK_TIMEOUT, signal })
    if (fetch.code !== 0) throw commandFailure(['fetch', fetchRemote, '--prune'], fetch)
    upstream = await resolveUpstream(run, cwd, branch, remote, signal)
    const counts = await trackingCounts(run, upstream, signal)
    if (counts.behind > 0) {
      const merged = await integrateRemote({
        run,
        cwd,
        upstream: upstream.hasUpstream ? upstream.upstreamRef : upstream.remoteRef,
        autoStash: true,
        signal,
        note,
      })
      if (merged.conflict) {
        return {
          mode: 'push',
          branch,
          remote: fetchRemote,
          upstream: upstream.upstreamRef || null,
          ahead: 0,
          behind: counts.behind,
          hasUpstream: upstream.hasUpstream,
          merged: null,
          pushed: false,
          stashed: merged.stashed,
          conflict: true,
          conflictFiles: merged.conflictFiles,
          stashHash: merged.stashHash ?? null,
          stashRestoreConflict: !!merged.stashRestoreConflict,
          stashRestoreFailed: !!merged.stashRestoreFailed,
          steps,
          output: merged.output,
        }
      }
      if (merged.merged) mergeKind = merged.merged
      if (merged.stashRestoreFailed) {
        stashRestoreFailed = true
        pendingStashHash = merged.stashHash ?? null
      }
    }
  }
  throw commandFailure(['push'], result)
}

async function pushOnce(run, cwd, branch, upstream, signal) {
  if (upstream.hasUpstream) {
    return run(['push'], { allowFailure: true, timeoutMs: NETWORK_TIMEOUT, signal })
  }
  return run(['push', '-u', upstream.remote, branch], { allowFailure: true, timeoutMs: NETWORK_TIMEOUT, signal })
}

/**
 * Push annotated tags that reach the branch. A release tag (`npm version`)
 * lives only in the local repository until it is pushed explicitly, so a
 * branch-only push leaves the remote without it. Tag failures do not fail the
 * sync: the branch is already up to date, and a conflicting remote tag needs a
 * deliberate decision rather than a retry.
 */
async function pushTags(run, signal) {
  const listed = await run(['tag', '-l'], { allowFailure: true, signal })
  if (listed.code !== 0 || String(listed.stdout || '').trim() === '') return null
  return run(['push', '--follow-tags'], { allowFailure: true, timeoutMs: NETWORK_TIMEOUT, signal })
}

function isRejectedPush(result) {
  const text = `${result.stderr}\n${result.stdout}`
  return /non-fast-forward|fetch first|rejected|failed to push some refs|updates were rejected|no such ref was fetched|no upstream branch|has no upstream branch/i.test(text)
}

/** List unresolved conflict paths. */
export async function unmergedFiles(run, signal) {
  const result = await run(['diff', '--name-only', '--diff-filter=U', '-z'], { allowFailure: true, signal })
  return String(result.stdout || '').split('\0').filter(Boolean)
}

function remoteOfRef(ref) {
  const value = String(ref ?? '')
  const slash = value.indexOf('/')
  return slash > 0 ? value.slice(0, slash) : ''
}

async function listRemotes(run, signal) {
  const result = await run(['remote'], { allowFailure: true, signal })
  return String(result.stdout || '').split('\n').map((line) => line.trim()).filter(Boolean)
}