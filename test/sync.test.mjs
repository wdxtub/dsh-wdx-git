import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { createOperations } from '../src/operations.js'
import { exec, createRepo, cloneRepo, write, git, tempDir, cleanup } from './helpers.mjs'

test('sync publishes a new local branch and establishes its upstream', async (t) => {
  const env = await createRepo()
  t.after(() => cleanup(env.base))
  const operations = createOperations({ exec })
  const call = (op, params = {}) => operations.handle(op, { cwd: env.repo, ...params })

  await call('createBranch', { name: 'feat/publish' })
  await write(env.repo, 'feature.txt', 'feature\n')
  await call('commit', { message: 'feat: publish me' })

  let snapshot = await call('snapshot')
  assert.equal(snapshot.repo.branch, 'feat/publish')
  assert.equal(snapshot.repo.upstream, null)
  assert.equal(snapshot.repo.ahead, 0)

  const result = await call('sync')
  assert.equal(result.pushed, true)
  assert.equal(result.conflict, false)
  assert.equal(result.hasUpstream, true)
  assert.equal(result.upstream, 'origin/feat/publish')

  snapshot = await call('snapshot')
  assert.equal(snapshot.repo.upstream, 'origin/feat/publish')
  assert.equal(snapshot.repo.ahead, 0)
  assert.equal(snapshot.repo.behind, 0)
})

test('sync fast-forwards behind commits and restores dirty local edits from a stash', async (t) => {
  const env = await createRepo()
  t.after(() => cleanup(env.base))
  const clone = await cloneRepo(env.base)
  const operations = createOperations({ exec })
  const local = (op, params = {}) => operations.handle(op, { cwd: env.repo, ...params })
  const other = (op, params = {}) => operations.handle(op, { cwd: clone, ...params })

  await write(clone, 'incoming.txt', 'from remote\n')
  await other('commit', { message: 'feat: incoming' })
  await other('sync')

  await write(env.repo, 'draft.txt', 'local draft\n')
  const result = await local('sync')
  assert.equal(result.conflict, false)
  assert.equal(result.stashed, true)
  assert.equal(result.merged, 'fast-forward')
  assert.equal(await readFile(`${env.repo}/draft.txt`, 'utf8'), 'local draft\n')
  assert.equal(await readFile(`${env.repo}/incoming.txt`, 'utf8'), 'from remote\n')

  const snapshot = await local('snapshot')
  assert.equal(snapshot.repo.behind, 0)
  assert.deepEqual(snapshot.status.untracked.map((entry) => entry.path), ['draft.txt'])
})

test('sync merges diverged histories, creates a merge commit and pushes', async (t) => {
  const env = await createRepo()
  t.after(() => cleanup(env.base))
  const clone = await cloneRepo(env.base)
  const operations = createOperations({ exec })
  const local = (op, params = {}) => operations.handle(op, { cwd: env.repo, ...params })
  const other = (op, params = {}) => operations.handle(op, { cwd: clone, ...params })

  await write(clone, 'remote.txt', 'remote\n')
  await other('commit', { message: 'feat: remote side' })
  await other('sync')

  await write(env.repo, 'local.txt', 'local\n')
  await local('commit', { message: 'feat: local side' })
  // A repository policy that would otherwise block automatic merges must not
  // stop the Sync action; it explicitly tries ff-only first, then merges.
  await git(['config', 'merge.ff', 'only'], env.repo)

  const result = await local('sync')
  assert.equal(result.conflict, false)
  assert.equal(result.merged, 'merge')
  assert.equal(result.pushed, true)

  const graph = await local('graph', { all: true })
  assert.ok(graph.commits.some((commit) => /Merge/.test(commit.subject)))
  const snapshot = await local('snapshot')
  assert.equal(snapshot.repo.ahead, 0)
  assert.equal(snapshot.repo.behind, 0)
})

test('push retries once when the remote moved after the last fetch', async (t) => {
  const env = await createRepo()
  t.after(() => cleanup(env.base))
  const clone = await cloneRepo(env.base)
  const operations = createOperations({ exec })
  const local = (op, params = {}) => operations.handle(op, { cwd: env.repo, ...params })
  const other = (op, params = {}) => operations.handle(op, { cwd: clone, ...params })

  await write(clone, 'remote.txt', 'remote\n')
  await other('commit', { message: 'feat: remote' })
  await git(['push', '-q'], clone)

  await write(env.repo, 'local.txt', 'local\n')
  await local('commit', { message: 'feat: local' })

  const result = await local('push')
  assert.equal(result.pushed, true)
  assert.equal(result.merged, 'merge')
  assert.equal(result.conflict, false)
  const snapshot = await local('snapshot')
  assert.equal(snapshot.repo.ahead, 0)
  assert.equal(snapshot.repo.behind, 0)
})

test('pull merges remote work but does not push local commits', async (t) => {
  const env = await createRepo()
  t.after(() => cleanup(env.base))
  const clone = await cloneRepo(env.base)
  const operations = createOperations({ exec })
  const local = (op, params = {}) => operations.handle(op, { cwd: env.repo, ...params })
  const other = (op, params = {}) => operations.handle(op, { cwd: clone, ...params })

  await write(clone, 'remote.txt', 'remote\n')
  await other('commit', { message: 'feat: remote' })
  await other('sync')
  await write(env.repo, 'local.txt', 'local\n')
  await local('commit', { message: 'feat: local' })

  const result = await local('pull')
  assert.equal(result.pushed, false)
  assert.equal(result.merged, 'merge')
  const snapshot = await local('snapshot')
  assert.equal(snapshot.repo.ahead, 2)
  assert.equal(snapshot.repo.behind, 0)
})

test('sync reports a clear error when the repository has no remote', async (t) => {
  const base = await tempDir()
  t.after(() => cleanup(base))
  const repo = join(base, 'solo')
  await mkdir(repo)
  await git(['init', '-q', '-b', 'main'], repo)
  await git(['config', 'user.email', 'solo@example.com'], repo)
  await git(['config', 'user.name', 'Solo'], repo)
  await write(repo, 'a.txt', 'a\n')
  await git(['add', '-A'], repo)
  await git(['commit', '-q', '-m', 'init'], repo)

  const operations = createOperations({ exec })
  const error = await operations.handle('sync', { cwd: repo }).catch((reason) => reason)
  assert.equal(error.code, 'no-remote')
  assert.match(error.message, /remote|远端/i)
})

test('a dirty worktree that conflicts with a fast-forward leaves a stash and conflict markers', async (t) => {
  const env = await createRepo()
  t.after(() => cleanup(env.base))
  const clone = await cloneRepo(env.base)
  const operations = createOperations({ exec })
  const local = (op, params = {}) => operations.handle(op, { cwd: env.repo, ...params })
  const other = (op, params = {}) => operations.handle(op, { cwd: clone, ...params })

  await write(clone, 'README.md', '# remote\n')
  await other('commit', { message: 'fix: remote readme' })
  await other('sync')
  await write(env.repo, 'README.md', '# local wip\n')

  const result = await local('sync')
  assert.equal(result.conflict, true)
  assert.equal(result.stashed, true)
  assert.deepEqual(result.conflictFiles, ['README.md'])
  assert.equal(result.pushed, false)
  const text = await readFile(`${env.repo}/README.md`, 'utf8')
  assert.match(text, /<<<<<<< /)

  const snapshot = await local('snapshot')
  assert.equal(snapshot.stashes.length, 1)
  assert.equal(snapshot.status.conflicted.length, 1)
})
test('sync on an empty repository only fetches and never attempts an impossible first push', async (t) => {
  const base = await tempDir()
  t.after(() => cleanup(base))
  const repo = join(base, 'empty')
  const remote = join(base, 'remote.git')
  await mkdir(repo)
  await mkdir(remote)
  await git(['init', '--bare', '-q', '-b', 'main'], remote)
  await git(['init', '-q', '-b', 'main'], repo)
  await git(['config', 'user.email', 'empty@example.com'], repo)
  await git(['config', 'user.name', 'Empty'], repo)
  await git(['remote', 'add', 'origin', remote], repo)

  const operations = createOperations({ exec })
  const result = await operations.handle('sync', { cwd: repo })
  assert.equal(result.pushed, false)
  assert.equal(result.conflict, false)
  const snapshot = await operations.handle('snapshot', { cwd: repo })
  assert.equal(snapshot.repo.initial, true)
  assert.equal(snapshot.repo.head, null)
  const graph = await operations.handle('graph', { cwd: repo, all: false })
  assert.deepEqual(graph.commits, [])
})
