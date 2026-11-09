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
