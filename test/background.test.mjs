import test from 'node:test'
import assert from 'node:assert/strict'
import { createOperations } from '../src/operations.js'
import { exec, createRepo, cloneRepo, write, git, cleanup } from './helpers.mjs'

const NO_SIGNAL = new AbortController().signal

/** Wait until the repository's background task reports a terminal state. */
async function settle(operations, cwd, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const snapshot = await operations.handle('snapshot', { cwd }, NO_SIGNAL)
    if (snapshot.background && snapshot.background.status !== 'running') return snapshot
    await new Promise((resolve) => setTimeout(resolve, 60))
  }
  throw new Error('background task did not finish in time')
}

test('a background push survives a cancelled request', async (t) => {
  const env = await createRepo()
  t.after(() => cleanup(env.base))
  const operations = createOperations({ exec })

  await write(env.repo, 'feature.txt', 'work\n')
  await operations.handle('commit', { cwd: env.repo, message: 'feat: add feature', autoStage: true }, NO_SIGNAL)

  const started = await operations.handle('sync', { cwd: env.repo, background: true }, AbortSignal.abort())
  assert.equal(started.background, true)
  assert.equal(started.task.status, 'running')
  assert.equal(started.task.mode, 'sync')

  const snapshot = await settle(operations, env.repo)
  assert.equal(snapshot.background.status, 'done')
  assert.equal(snapshot.background.pushed, true)
  assert.equal(snapshot.repo.ahead, 0)
  assert.equal(snapshot.repo.behind, 0)
  assert.equal(await git(['rev-parse', 'main'], env.remote), await git(['rev-parse', 'HEAD'], env.repo))
})

test('a repeated request reports the running task instead of starting another', async (t) => {
  const env = await createRepo()
  t.after(() => cleanup(env.base))
  const operations = createOperations({ exec })

  await write(env.repo, 'a.txt', 'a\n')
  await operations.handle('commit', { cwd: env.repo, message: 'feat: a', autoStage: true }, NO_SIGNAL)
  const first = await operations.handle('sync', { cwd: env.repo, background: true }, NO_SIGNAL)
  assert.equal(first.task.status, 'running')

  const second = await operations.handle('sync', { cwd: env.repo, background: true }, NO_SIGNAL)
  assert.equal(second.task.id, first.task.id)

  const snapshot = await settle(operations, env.repo)
  assert.equal(snapshot.background.status, 'done')
  assert.equal(snapshot.background.pushed, true)
  assert.equal(snapshot.repo.ahead, 0)
  assert.equal(await git(['rev-parse', 'main'], env.remote), await git(['rev-parse', 'HEAD'], env.repo))
})

test('a background sync reports conflicts instead of failing silently', async (t) => {
  const env = await createRepo()
  t.after(() => cleanup(env.base))
  const clone = await cloneRepo(env.base)
  const operations = createOperations({ exec })

  await write(env.repo, 'shared.txt', 'ours\n')
  await operations.handle('commit', { cwd: env.repo, message: 'feat: ours', autoStage: true }, NO_SIGNAL)
  await write(clone, 'shared.txt', 'theirs\n')
  await git(['add', '-A'], clone)
  await git(['commit', '-q', '-m', 'feat: theirs'], clone)
  await git(['push', '-q', 'origin', 'main'], clone)

  const started = await operations.handle('sync', { cwd: env.repo, background: true }, AbortSignal.abort())
  assert.equal(started.task.status, 'running')

  const snapshot = await settle(operations, env.repo)
  assert.equal(snapshot.background.status, 'conflict')
  assert.equal(snapshot.background.pushed, false)
  assert.deepEqual(snapshot.background.conflictFiles, ['shared.txt'])
  assert.equal(snapshot.operation.inProgress, true)
  assert.equal(snapshot.status.conflicted.length, 1)
})

test('a background task reports its failure', async (t) => {
  const env = await createRepo()
  t.after(() => cleanup(env.base))
  await git(['remote', 'remove', 'origin'], env.repo)
  const operations = createOperations({ exec })

  await write(env.repo, 'x.txt', 'x\n')
  await operations.handle('commit', { cwd: env.repo, message: 'feat: x', autoStage: true }, NO_SIGNAL)
  const started = await operations.handle('push', { cwd: env.repo, background: true }, NO_SIGNAL)
  assert.equal(started.task.status, 'running')

  const snapshot = await settle(operations, env.repo)
  assert.equal(snapshot.background.status, 'failed')
  assert.equal(snapshot.background.pushed, false)
  assert.equal(snapshot.background.errorCode, 'no-remote')
  assert.match(snapshot.background.error, /远端/)
})
