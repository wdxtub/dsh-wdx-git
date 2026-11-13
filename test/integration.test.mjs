import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createOperations } from '../src/operations.js'
import { exec, createRepo, cloneRepo, write, git, cleanup, tempDir } from './helpers.mjs'

test('snapshot, staging, diff, auto-stage commit and history work on a real repository', async (t) => {
  const env = await createRepo()
  t.after(() => cleanup(env.base))
  const operations = createOperations({ exec })
  const call = (op, params = {}) => operations.handle(op, { cwd: env.repo, ...params })

  await write(env.repo, 'src/app.js', 'export const value = 1\n')
  await write(env.repo, 'notes.txt', 'hello\n')

  let snapshot = await call('snapshot')
  assert.equal(snapshot.repo.isRepo, true)
  assert.equal(snapshot.repo.branch, 'main')
  assert.equal(snapshot.repo.upstream, 'origin/main')
  assert.equal(snapshot.repo.name, 'repo')
  assert.equal(snapshot.repo.hasRemote, true)
  assert.equal(snapshot.user.name, 'Test User')
  assert.deepEqual(snapshot.status.untracked.map((entry) => entry.path).sort(), ['notes.txt', 'src/app.js'])
  assert.equal(snapshot.status.clean, false)
  assert.equal(snapshot.operation.inProgress, false)

  await call('stage', { paths: ['src/app.js'] })
  snapshot = await call('snapshot')
  assert.deepEqual(snapshot.status.staged.map((entry) => entry.path), ['src/app.js'])
  assert.deepEqual(snapshot.status.untracked.map((entry) => entry.path), ['notes.txt'])

  const stagedDiff = await call('diff', { mode: 'staged', path: 'src/app.js' })
  assert.equal(stagedDiff.files.length, 1)
  assert.equal(stagedDiff.additions, 1)
  assert.ok(stagedDiff.files[0].hunks.length > 0)

  await call('unstage', { paths: ['src/app.js'] })
  snapshot = await call('snapshot')
  assert.equal(snapshot.status.staged.length, 0)

  const untrackedDiff = await call('diff', { mode: 'untracked', path: 'notes.txt' })
  assert.equal(untrackedDiff.files.length, 1)
  assert.equal(untrackedDiff.files[0].path, 'notes.txt')

  const commit = await call('commit', { message: 'feat: add initial files' })
  assert.match(commit.hash, /^[0-9a-f]+$/)
  assert.equal(commit.subject, 'feat: add initial files')
  snapshot = await call('snapshot')
  assert.equal(snapshot.status.clean, true)

  const graph = await call('graph', { all: true })
  assert.equal(graph.commits.length, 2)
  assert.equal(graph.commits[0].subject, 'feat: add initial files')
  assert.equal(graph.commits[0].refs.some((ref) => ref.startsWith('HEAD')), true)
  assert.ok(Array.isArray(graph.commits[0].trails))

  const info = await call('commitInfo', { hash: graph.commits[0].full })
  assert.equal(info.subject, 'feat: add initial files')
  assert.equal(info.author, 'Test User')

  const commitDiff = await call('diff', { mode: 'commit', hash: graph.commits[0].full })
  assert.ok(commitDiff.files.length >= 2)
  assert.ok(commitDiff.additions >= 2)

  const currentOnly = await call('graph', { all: false })
  assert.equal(currentOnly.all, false)
  assert.ok(currentOnly.commits.length >= 2)
})

test('overview summarizes every workspace without failing on non-repositories', async (t) => {
  const env = await createRepo()
  const other = await createRepo()
  const plain = await tempDir()
  t.after(() => cleanup(env.base))
  t.after(() => cleanup(other.base))
  t.after(() => cleanup(plain))

  await write(env.repo, 'a.txt', 'a\n')
  await write(env.repo, 'b.txt', 'b\n')
  await write(other.repo, 'README.md', '# changed\n')

  const operations = createOperations({ exec })
  const result = await operations.handle('overview', {
    paths: [env.repo, other.repo, plain, '/definitely/not/here'],
  })

  assert.equal(result.repos.length, 4)
  const main = result.repos.find((row) => row.path === env.repo)
  assert.equal(main.isRepo, true)
  assert.equal(main.name, 'repo')
  assert.equal(main.branch, 'main')
  assert.equal(main.changed, 2)
  assert.equal(main.clean, false)
  assert.equal(main.ahead, 0)

  const modified = result.repos.find((row) => row.path === other.repo)
  assert.equal(modified.isRepo, true)
  assert.equal(modified.changed, 1)
  assert.equal(modified.clean, false)

  const nonRepo = result.repos.find((row) => row.path === plain)
  assert.equal(nonRepo.isRepo, false)
  assert.ok(nonRepo.error)

  const missing = result.repos.find((row) => row.path === '/definitely/not/here')
  assert.equal(missing.isRepo, false)
  assert.ok(missing.error)
})

test('branches, stash and discard run against real git state', async (t) => {
  const env = await createRepo()
  t.after(() => cleanup(env.base))
  const operations = createOperations({ exec })
  const call = (op, params = {}) => operations.handle(op, { cwd: env.repo, ...params })

  const created = await call('createBranch', { name: 'feat/panel' })
  assert.equal(created.branch, 'feat/panel')
  let snapshot = await call('snapshot')
  assert.equal(snapshot.repo.branch, 'feat/panel')
  assert.equal(snapshot.branches.filter((branch) => branch.current)[0].name, 'feat/panel')

  await call('switchBranch', { name: 'main' })
  snapshot = await call('snapshot')
  assert.equal(snapshot.repo.branch, 'main')
  await call('deleteBranch', { name: 'feat/panel' })
  snapshot = await call('snapshot')
  assert.equal(snapshot.branches.some((branch) => branch.name === 'feat/panel'), false)

  await write(env.repo, 'README.md', '# changed\n')
  await write(env.repo, 'wip.txt', 'wip\n')
  await call('stashPush', { includeUntracked: true, message: 'panel work' })
  snapshot = await call('snapshot')
  assert.equal(snapshot.status.clean, true)
  assert.equal(snapshot.stashes.length, 1)
  assert.match(snapshot.stashes[0].message, /panel work/)

  await call('stashPop', { index: 0 })
  snapshot = await call('snapshot')
  assert.equal(snapshot.stashes.length, 0)
  assert.equal(snapshot.status.unstaged.length, 1)
  assert.equal(snapshot.status.untracked.length, 1)

  await call('discard', { paths: ['wip.txt'], mode: 'untracked' })
  await call('discard', { paths: ['README.md'], mode: 'worktree' })
  snapshot = await call('snapshot')
  assert.equal(snapshot.status.clean, true)
  assert.equal(await readFile(`${env.repo}/README.md`, 'utf8'), '# repo\n')
})

test('conflict files can be inspected, resolved and committed', async (t) => {
  const env = await createRepo()
  t.after(() => cleanup(env.base))
  const clone = await cloneRepo(env.base)
  const operations = createOperations({ exec })
  const local = (op, params = {}) => operations.handle(op, { cwd: env.repo, ...params })
  const other = (op, params = {}) => operations.handle(op, { cwd: clone, ...params })

  await write(clone, 'README.md', '# incoming\n')
  await other('commit', { message: 'fix: incoming readme' })
  await other('sync')

  await write(env.repo, 'README.md', '# ours\n')
  await local('commit', { message: 'fix: local readme' })

  const conflicted = await local('sync')
  assert.equal(conflicted.conflict, true)
  assert.deepEqual(conflicted.conflictFiles, ['README.md'])
  assert.equal(conflicted.pushed, false)

  let snapshot = await local('snapshot')
  assert.equal(snapshot.status.conflicted.length, 1)
  assert.equal(snapshot.operation.merge, true)
  assert.equal(snapshot.operation.inProgress, true)

  const info = await local('conflictInfo', { path: 'README.md' })
  assert.equal(info.oursExists, true)
  assert.equal(info.theirsExists, true)
  assert.match(info.ours, /# ours/)
  assert.match(info.theirs, /# incoming/)

  const blocked = await local('commit', { message: 'merge: should not work' }).catch((error) => error)
  assert.equal(blocked.code, 'conflict')

  const stageAll = await local('stage', { all: true }).catch((error) => error)
  assert.equal(stageAll.code, 'conflict')
  const unstageAll = await local('unstage', { all: true }).catch((error) => error)
  assert.equal(unstageAll.code, 'conflict')
  const unstageConflict = await local('unstage', { paths: ['README.md'] }).catch((error) => error)
  assert.equal(unstageConflict.code, 'conflict')
  const discardConflict = await local('discard', { paths: ['README.md'], mode: 'worktree' }).catch((error) => error)
  assert.equal(discardConflict.code, 'conflict')

  const diff = await local('diff', { mode: 'worktree', path: 'README.md' })
  assert.equal(diff.conflict, true)
  assert.ok(diff.files.length === 1)

  await local('takeSide', { path: 'README.md', side: 'theirs' })
  snapshot = await local('snapshot')
  assert.equal(snapshot.status.conflicted.length, 0)
  assert.equal(await readFile(`${env.repo}/README.md`, 'utf8'), '# incoming\n')

  await local('commit', { message: 'merge: resolve readme conflict' })
  snapshot = await local('snapshot')
  assert.equal(snapshot.operation.inProgress, false)
  const pushed = await local('sync')
  assert.equal(pushed.conflict, false)
  assert.equal(pushed.pushed, true)
})

test('an in-progress merge can be aborted', async (t) => {
  const env = await createRepo()
  t.after(() => cleanup(env.base))
  const clone = await cloneRepo(env.base)
  const operations = createOperations({ exec })
  const local = (op, params = {}) => operations.handle(op, { cwd: env.repo, ...params })
  const other = (op, params = {}) => operations.handle(op, { cwd: clone, ...params })

  await write(clone, 'README.md', '# incoming\n')
  await other('commit', { message: 'fix: incoming' })
  await other('sync')
  await write(env.repo, 'README.md', '# ours\n')
  await local('commit', { message: 'fix: local' })
  const conflicted = await local('sync')
  assert.equal(conflicted.conflict, true)

  const aborted = await local('abortOperation')
  assert.ok(aborted.operation.inProgress === false)
  const snapshot = await local('snapshot')
  assert.equal(snapshot.status.conflicted.length, 0)
  assert.equal(await readFile(`${env.repo}/README.md`, 'utf8'), '# ours\n')
})

test('a finished rebase does not keep reporting itself in progress', async (t) => {
  const env = await createRepo()
  t.after(() => cleanup(env.base))
  const clone = await cloneRepo(env.base)
  const operations = createOperations({ exec })
  const local = (op, params = {}) => operations.handle(op, { cwd: env.repo, ...params })

  await write(clone, 'README.md', '# incoming\n')
  await git(['commit', '-qam', 'fix: incoming'], clone)
  await git(['push', '-q'], clone)
  await write(env.repo, 'README.md', '# ours\n')
  await git(['commit', '-qam', 'fix: local'], env.repo)
  await git(['fetch', '-q', 'origin'], env.repo)
  await assert.rejects(git(['rebase', 'origin/main'], env.repo), /could not apply|CONFLICT/)

  let snapshot = await local('snapshot')
  assert.equal(snapshot.operation.rebase, true)
  assert.equal(snapshot.status.conflicted.length, 1)

  await local('takeSide', { path: 'README.md', side: 'theirs' })
  const continued = await local('continueOperation')
  assert.equal(continued.operation.inProgress, false)

  // Git keeps the REBASE_HEAD pseudo-ref after a rebase finishes. Probing it
  // used to fake an in-progress rebase forever, so Continue answered
  // `fatal: no rebase in progress`.
  const staleRef = await exec(['git', 'rev-parse', '--verify', '--quiet', 'REBASE_HEAD'], { cwd: env.repo })
  assert.equal(staleRef.code, 0)

  snapshot = await local('snapshot')
  assert.equal(snapshot.operation.rebase, false)
  assert.equal(snapshot.operation.inProgress, false)

  const lateContinue = await local('continueOperation')
  assert.equal(lateContinue.stale, true)
  assert.equal(lateContinue.operation.inProgress, false)
  const lateAbort = await local('abortOperation')
  assert.equal(lateAbort.stale, true)
  assert.equal(lateAbort.operation.inProgress, false)
})

test('continuing a multi-commit rebase reports the next conflict instead of failing', async (t) => {
  const env = await createRepo()
  t.after(() => cleanup(env.base))
  const clone = await cloneRepo(env.base)
  const operations = createOperations({ exec })
  const local = (op, params = {}) => operations.handle(op, { cwd: env.repo, ...params })

  await write(clone, 'README.md', '# incoming\n')
  await git(['commit', '-qam', 'fix: incoming'], clone)
  await git(['push', '-q'], clone)
  await write(env.repo, 'README.md', '# ours one\n')
  await git(['commit', '-qam', 'fix: local one'], env.repo)
  await write(env.repo, 'README.md', '# ours two\n')
  await git(['commit', '-qam', 'fix: local two'], env.repo)
  await git(['fetch', '-q', 'origin'], env.repo)
  await assert.rejects(git(['rebase', 'origin/main'], env.repo), /could not apply|CONFLICT/)

  await local('applyResolution', { path: 'README.md', content: '# resolved one\n' })
  const mid = await local('continueOperation')
  assert.equal(mid.conflict, true)
  assert.equal(mid.stale, false)
  assert.equal(mid.operation.rebase, true)
  assert.equal(mid.operation.conflicted, 1)

  await local('applyResolution', { path: 'README.md', content: '# resolved two\n' })
  const done = await local('continueOperation')
  assert.equal(done.conflict, false)
  assert.equal(done.operation.inProgress, false)
})

test('continuing parks other unstaged edits and restores them afterwards', async (t) => {
  const env = await createRepo()
  t.after(() => cleanup(env.base))
  const operations = createOperations({ exec })
  const local = (op, params = {}) => operations.handle(op, { cwd: env.repo, ...params })

  await write(env.repo, 'extra.txt', 'base\n')
  await local('commit', { message: 'chore: tracked extra' })
  await local('sync')

  const clone = await cloneRepo(env.base)
  const other = (op, params = {}) => operations.handle(op, { cwd: clone, ...params })
  await write(clone, 'README.md', '# incoming\n')
  await other('commit', { message: 'fix: incoming readme' })
  await other('sync')
  await write(env.repo, 'README.md', '# ours\n')
  await local('commit', { message: 'fix: ours readme' })
  await git(['fetch', '-q', 'origin'], env.repo)
  await assert.rejects(git(['rebase', 'origin/main'], env.repo), /could not apply|CONFLICT/)

  await local('applyResolution', { path: 'README.md', content: '# resolved\n' })
  await write(env.repo, 'extra.txt', 'unstaged edit\n')

  const continued = await local('continueOperation')
  assert.equal(continued.conflict, false)
  assert.equal(continued.operation.inProgress, false)
  assert.match(String(continued.stashHash || ''), /^[0-9a-f]{40}$/)

  const pop = await local('stashPop', { hash: continued.stashHash })
  assert.equal(pop.conflict, false)
  assert.equal(await readFile(`${env.repo}/extra.txt`, 'utf8'), 'unstaged edit\n')
  const snapshot = await local('snapshot')
  assert.equal(snapshot.stashes.length, 0)
})

test('concurrent mutating RPCs on one repository are serialized', async (t) => {
  const env = await createRepo()
  t.after(() => cleanup(env.base))
  await write(env.repo, 'a.txt', 'a\n')
  await write(env.repo, 'b.txt', 'b\n')

  let active = 0
  let peak = 0
  const slowExec = async (argv, options) => {
    const probe = argv.includes('--show-toplevel')
    if (!probe) {
      active += 1
      peak = Math.max(peak, active)
    }
    try {
      await new Promise((resolve) => setTimeout(resolve, 15))
      return await exec(argv, options)
    } finally {
      if (!probe) active -= 1
    }
  }
  const operations = createOperations({ exec: slowExec })
  await Promise.all([
    operations.handle('stage', { cwd: env.repo, paths: ['a.txt'] }),
    operations.handle('stage', { cwd: env.repo, paths: ['b.txt'] }),
  ])
  assert.equal(peak, 1, 'git commands for mutating RPCs must not overlap')

  const snapshot = await operations.handle('snapshot', { cwd: env.repo })
  assert.deepEqual(snapshot.status.staged.map((entry) => entry.path).sort(), ['a.txt', 'b.txt'])
})

test('an empty cherry-pick is skipped instead of stranding the panel', async (t) => {
  const env = await createRepo()
  t.after(() => cleanup(env.base))
  const operations = createOperations({ exec })
  const local = (op, params = {}) => operations.handle(op, { cwd: env.repo, ...params })

  await write(env.repo, 'f.txt', 'base\n')
  await git(['add', '-A'], env.repo)
  await git(['commit', '-qm', 'chore: base'], env.repo)
  await write(env.repo, 'g.txt', 'x\n')
  await git(['add', '-A'], env.repo)
  await git(['commit', '-qm', 'feat: g'], env.repo)

  await git(['switch', '-q', '-c', 'side', 'HEAD~1'], env.repo)
  await write(env.repo, 'g.txt', 'x\n')
  await git(['add', '-A'], env.repo)
  await git(['commit', '-qm', 'feat: duplicate'], env.repo)
  const picked = await exec(['git', 'cherry-pick', 'main'], { cwd: env.repo })
  assert.notEqual(picked.code, 0)

  let snapshot = await local('snapshot')
  assert.equal(snapshot.operation.cherryPick, true)
  assert.equal(snapshot.status.conflicted.length, 0)

  const continued = await local('continueOperation')
  assert.equal(continued.skipped, true)
  assert.equal(continued.conflict, false)
  assert.equal(continued.operation.inProgress, false)
})

test('initial repository unstaging and invalid parameter guards work', async (t) => {
  const env = await createRepo()
  t.after(() => cleanup(env.base))
  const operations = createOperations({ exec })
  const call = (op, params = {}) => operations.handle(op, { cwd: env.repo, ...params })

  const noRepo = await operations.handle('snapshot', { cwd: '/' })
  assert.equal(noRepo.repo.isRepo, false)

  const badCwd = await operations.handle('snapshot', { cwd: 'relative/path' }).catch((error) => error)
  assert.equal(badCwd.code, 'invalid-params')

  const badOp = await operations.handle('nope', { cwd: env.repo }).catch((error) => error)
  assert.equal(badOp.code, 'invalid-params')

  const traversal = await operations.handle('stage', { cwd: env.repo, paths: ['../outside'] }).catch((error) => error)
  assert.equal(traversal.code, 'invalid-params')

  const unknownDiff = await call('diff', { mode: 'nope' }).catch((error) => error)
  assert.equal(unknownDiff.code, 'invalid-params')

  await write(env.repo, 'a.txt', 'a\n')
  await call('stage', { all: true })
  await call('unstage', { all: true })
  const snapshot = await call('snapshot')
  assert.equal(snapshot.status.staged.length, 0)
  assert.equal(snapshot.status.untracked.length, 1)
})
test('switching to a remote branch creates a local tracking branch, and an existing local branch wins', async (t) => {
  const env = await createRepo()
  t.after(() => cleanup(env.base))
  const operations = createOperations({ exec })
  const call = (op, params = {}) => operations.handle(op, { cwd: env.repo, ...params })

  await call('createBranch', { name: 'feat/remote-switch' })
  await write(env.repo, 'feature.txt', 'feature\n')
  await call('commit', { message: 'feat: remote switch' })
  await call('sync')
  await call('switchBranch', { name: 'main' })
  await call('deleteBranch', { name: 'feat/remote-switch' })

  let snapshot = await call('snapshot')
  assert.equal(snapshot.branches.some((branch) => branch.name === 'origin/feat/remote-switch'), true)
  assert.equal(snapshot.branches.some((branch) => branch.name === 'feat/remote-switch'), false)

  const switched = await call('switchBranch', { name: 'origin/feat/remote-switch' })
  assert.equal(switched.branch, 'feat/remote-switch')
  snapshot = await call('snapshot')
  assert.equal(snapshot.repo.branch, 'feat/remote-switch')
  assert.equal(snapshot.repo.upstream, 'origin/feat/remote-switch')

  await call('switchBranch', { name: 'main' })
  await call('switchBranch', { name: 'feat/remote-switch' })
  const again = await call('snapshot')
  assert.equal(again.repo.branch, 'feat/remote-switch')
})

test('auto-stage commits deletions and the per-repo commit prompt can be set and reset', async (t) => {
  const env = await createRepo()
  t.after(() => cleanup(env.base))
  const operations = createOperations({ exec })
  const call = (op, params = {}) => operations.handle(op, { cwd: env.repo, ...params })

  await write(env.repo, 'remove-me.txt', 'x\n')
  await call('commit', { message: 'feat: add removable file' })
  const { rm } = await import('node:fs/promises')
  await rm(`${env.repo}/remove-me.txt`)
  const snapshot = await call('snapshot')
  assert.equal(snapshot.status.unstaged.some((entry) => entry.path === 'remove-me.txt'), true)

  const commit = await call('commit', { message: 'chore: remove file' })
  assert.equal(commit.subject, 'chore: remove file')
  const after = await call('snapshot')
  assert.equal(after.status.clean, true)
  const diff = await call('diff', { mode: 'commit', hash: commit.hash })
  assert.equal(diff.files.some((file) => file.status === 'D'), true)

  let prompt = await call('setCommitPrompt', { prompt: 'Write short Chinese commit subjects.' })
  assert.match(prompt.prompt, /short Chinese/)
  let snap = await call('snapshot')
  assert.match(snap.commitPrompt, /short Chinese/)
  prompt = await call('setCommitPrompt', { prompt: '' })
  assert.equal(prompt.prompt, '')
  snap = await call('snapshot')
  assert.equal(snap.commitPrompt, '')
})

test('a manually edited conflict can be marked resolved after conflict markers are cleaned', async (t) => {
  const env = await createRepo()
  t.after(() => cleanup(env.base))
  const clone = await cloneRepo(env.base)
  const operations = createOperations({ exec })
  const local = (op, params = {}) => operations.handle(op, { cwd: env.repo, ...params })
  const other = (op, params = {}) => operations.handle(op, { cwd: clone, ...params })

  await write(clone, 'README.md', '# incoming\n')
  await other('commit', { message: 'fix: incoming' })
  await other('sync')
  await write(env.repo, 'README.md', '# ours\n')
  await local('commit', { message: 'fix: local' })
  await local('sync')

  const rejected = await local('markResolved', { path: 'README.md' }).catch((error) => error)
  assert.equal(rejected.code, 'invalid-params')
  assert.match(rejected.message, /冲突标记/)

  await write(env.repo, 'README.md', '# merged by hand\n')
  const marked = await local('markResolved', { path: 'README.md' })
  assert.equal(marked.resolved, true)
  assert.equal(marked.unmerged, 0)

  const snapshot = await local('snapshot')
  assert.equal(snapshot.status.conflicted.length, 0)
  await local('commit', { message: 'merge: hand resolution' })
  const pushed = await local('sync')
  assert.equal(pushed.pushed, true)
})

test('discard works on staged files before the first commit', async (t) => {
  const repo = await tempDir()
  t.after(() => cleanup(repo))
  await git(['init', '-q', '-b', 'main'], repo)
  await git(['config', 'user.email', 'a@b.c'], repo)
  await git(['config', 'user.name', 'A'], repo)
  await write(repo, 'a.txt', 'a\n')
  await write(repo, 'b.txt', 'b\n')
  await git(['add', '-A'], repo)

  const operations = createOperations({ exec })
  const call = (op, params = {}) => operations.handle(op, { cwd: repo, ...params })
  await write(repo, 'a.txt', 'a changed\n')
  await call('discard', { paths: ['a.txt'], mode: 'worktree' })
  assert.equal(await readFile(`${repo}/a.txt`, 'utf8'), 'a\n')

  await call('discard', { paths: ['a.txt'], mode: 'all' })
  const snapshot = await call('snapshot')
  assert.equal(snapshot.status.staged.some((entry) => entry.path === 'a.txt'), false)
  assert.equal(await readFile(`${repo}/b.txt`, 'utf8'), 'b\n')
  const aExists = await readFile(`${repo}/a.txt`, 'utf8').then(() => true).catch(() => false)
  assert.equal(aExists, false)
})

test('commit can stage only the selected paths and unstage excluded ones', async (t) => {
  const env = await createRepo()
  t.after(() => cleanup(env.base))
  const operations = createOperations({ exec })
  const call = (op, params = {}) => operations.handle(op, { cwd: env.repo, ...params })

  await write(env.repo, 'a.txt', 'a\n')
  await write(env.repo, 'b.txt', 'b\n')
  const partial = await call('commit', { message: 'feat: only a', paths: ['a.txt'] })
  assert.match(partial.hash, /^[0-9a-f]+$/)
  let snapshot = await call('snapshot')
  assert.equal(snapshot.status.untracked.some((entry) => entry.path === 'b.txt'), true)
  assert.equal(snapshot.status.clean, false)

  await call('stage', { all: true })
  await write(env.repo, 'c.txt', 'c\n')
  await call('stage', { all: true })
  const excluded = await call('commit', { message: 'feat: b only', paths: ['b.txt', 'c.txt'], exclude: ['c.txt'] })
  assert.match(excluded.hash, /^[0-9a-f]+$/)
  snapshot = await call('snapshot')
  assert.equal(snapshot.status.untracked.some((entry) => entry.path === 'c.txt'), true)
  assert.equal(snapshot.status.staged.some((entry) => entry.path === 'c.txt'), false)
  const graph = await call('graph', { all: true })
  assert.equal(graph.commits[0].subject, 'feat: b only')
})
