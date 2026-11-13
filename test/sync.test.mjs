import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { createOperations } from '../src/operations.js'
import { integrate } from '../src/sync.js'
import { exec, createRepo, cloneRepo, write, git, tempDir, cleanup } from './helpers.mjs'

test('push keeps retrying while the remote moves again during merges', async (t) => {
  const env = await createRepo()
  t.after(() => cleanup(env.base))
  const clone = await cloneRepo(env.base)

  await write(env.repo, 'local.txt', 'local\n')
  await git(['add', '-A'], env.repo)
  await git(['commit', '-qm', 'feat: local'], env.repo)

  let pushes = 0
  const run = async (args, options = {}) => {
    if (args[0] === 'push') {
      pushes += 1
      // Land a new remote commit before each of the first two attempts so the
      // loop has to fetch + merge again instead of giving up after one retry.
      if (pushes <= 2) {
        await write(clone, `remote-${pushes}.txt`, 'remote\n')
        await git(['add', '-A'], clone)
        await git(['commit', '-qm', `feat: remote ${pushes}`], clone)
        await git(['push', '-q'], clone)
      }
    }
    return exec(['git', ...args], { cwd: env.repo, ...options })
  }

  const result = await integrate({ run, mode: 'push', cwd: env.repo })
  assert.equal(result.conflict, false)
  assert.equal(result.pushed, true)
  assert.equal(pushes, 3)
  assert.equal(result.merged, 'merge')
})

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

test('sync pushes annotated tags that reach the pushed branch', async (t) => {
  const env = await createRepo()
  t.after(() => cleanup(env.base))
  const operations = createOperations({ exec })
  const call = (op, params = {}) => operations.handle(op, { cwd: env.repo, ...params })

  await write(env.repo, 'tagged.txt', 'tagged\n')
  await call('commit', { message: 'feat: tag me' })
  await git(['tag', '-a', 'v0.0.1', '-m', 'v0.0.1'], env.repo)

  const result = await call('sync')
  assert.equal(result.pushed, true)
  assert.equal(await git(['tag', '-l'], env.remote), 'v0.0.1')
})

test('sync reports the auto-stash of a conflicted merge so it can be restored later', async (t) => {
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
  await local('commit', { message: 'fix: ours readme' })
  await write(env.repo, 'draft.txt', 'local draft\n')

  const result = await local('sync')
  assert.equal(result.conflict, true)
  assert.equal(result.stashed, true)
  assert.match(String(result.stashHash || ''), /^[0-9a-f]{40}$/)

  await local('applyResolution', { path: 'README.md', content: '# merged\n' })
  await local('commit', { message: 'merge: resolve readme' })

  const pop = await local('stashPop', { hash: result.stashHash })
  assert.equal(pop.conflict, false)
  assert.equal(pop.missing, false)
  assert.equal(await readFile(`${env.repo}/draft.txt`, 'utf8'), 'local draft\n')
  const snapshot = await local('snapshot')
  assert.equal(snapshot.stashes.length, 0)

  // This is what the panel does after resolving the conflict: the original
  // sync intent (fetch + merge + push) resumes without another click.
  const resumed = await local('sync')
  assert.equal(resumed.conflict, false)
  assert.equal(resumed.pushed, true)
})

test('a stash restore conflict keeps the stash addressable by hash', async (t) => {
  const env = await createRepo()
  t.after(() => cleanup(env.base))
  const operations = createOperations({ exec })
  const local = (op, params = {}) => operations.handle(op, { cwd: env.repo, ...params })

  await write(env.repo, 'shared.txt', 'base\n')
  await local('commit', { message: 'chore: shared base' })
  await local('sync')

  const clone = await cloneRepo(env.base)
  const other = (op, params = {}) => operations.handle(op, { cwd: clone, ...params })
  await write(clone, 'shared.txt', 'remote\n')
  await other('commit', { message: 'fix: remote shared' })
  await other('sync')

  await write(env.repo, 'shared.txt', 'local edit\n')
  const result = await local('sync')
  assert.equal(result.conflict, true)
  assert.equal(result.stashRestoreConflict, true)
  assert.match(String(result.stashHash || ''), /^[0-9a-f]{40}$/)

  await local('applyResolution', { path: 'shared.txt', content: 'merged\n' })
  const dropped = await local('stashDrop', { hash: result.stashHash })
  assert.equal(dropped.dropped, true)
  assert.equal(dropped.missing, false)

  const again = await local('stashPop', { hash: result.stashHash })
  assert.equal(again.missing, true)

  const snapshot = await local('snapshot')
  assert.equal(snapshot.stashes.length, 0)
  assert.equal(snapshot.status.conflicted.length, 0)
  assert.equal(await readFile(`${env.repo}/shared.txt`, 'utf8'), 'merged\n')
})
