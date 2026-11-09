import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createOperations } from '../src/operations.js'
import { chooseLowEffort, resolveModelSelection, looksLikeSubject } from '../src/ai.js'
import { exec, createRepo, cloneRepo, write, fakeSessions, cleanup, tempDir, git } from './helpers.mjs'

function captureLlm(text, { finish = 'stop', models } = {}) {
  const calls = []
  const catalog = models || [{ id: 'cheap', name: 'Cheap', provider: 'fake' }]
  return {
    calls,
    listProviders: () => [{ id: 'fake', name: 'Fake Provider' }],
    listModels: async (provider) => catalog.filter((model) => (model.provider || 'fake') === provider),
    resolveModelInfo: async (provider, model) => {
      const entry = catalog.find((item) => item.id === model)
      if (!entry) throw new Error(`unknown model ${model}`)
      return {
        provider,
        id: model,
        name: entry.name,
        reasoning: { efforts: [{ id: 'low', name: 'Low' }, { id: 'none', name: 'No thinking' }] },
      }
    },
    stream: (options) => ({
      async *[Symbol.asyncIterator]() {
        calls.push(options)
        options.signal?.throwIfAborted()
        yield { type: 'text-delta', text }
        yield { type: 'finish', reason: { kind: finish } }
      },
    }),
  }
}

function services(llm, sessions = fakeSessions({ provider: 'fake', model: 'cheap', reasoningEffort: 'high' })) {
  return () => ({
    llm,
    sessions,
    defaultModel: { currentSelection: () => ({ provider: 'fake', model: 'cheap', reasoningEffort: 'high' }) },
  })
}

test('chooseLowEffort prefers low, then an off-like effort', () => {
  assert.equal(chooseLowEffort(['high', 'low']), 'low')
  assert.equal(chooseLowEffort(['off', 'high']), 'off')
  assert.equal(chooseLowEffort(['none']), 'none')
  assert.equal(chooseLowEffort(['high']), undefined)
  assert.equal(chooseLowEffort([]), undefined)
})

test('resolveModelSelection clamps a session model to low effort', async () => {
  const llm = captureLlm('x')
  const resolved = await resolveModelSelection({
    llm,
    fallback: { provider: 'fake', model: 'cheap', reasoningEffort: 'high' },
    effortPreference: 'auto',
  })
  assert.equal(resolved.provider, 'fake')
  assert.equal(resolved.model, 'cheap')
  assert.equal(resolved.reasoningEffort, 'low')
  assert.equal(resolved.label, 'fake/cheap')
})

test('models exposes the session default and a low-effort recommendation', async (t) => {
  const env = await createRepo()
  t.after(() => cleanup(env.base))
  const llm = captureLlm('x')
  const operations = createOperations({ exec, services: services(llm) })
  const catalog = await operations.handle('models', { cwd: env.repo, sessionId: 'session-1' })
  assert.equal(catalog.groups.length, 1)
  assert.equal(catalog.groups[0].models[0].id, 'cheap')
  assert.equal(catalog.default.label, 'fake/cheap')
  assert.equal(catalog.default.reasoningEffort, 'low')
  assert.deepEqual(catalog.default.efforts, ['low', 'none'])
})

test('quick AI commit uses the session model at low effort and parses subject + body', async (t) => {
  const env = await createRepo()
  t.after(() => cleanup(env.base))
  await write(env.repo, 'src/feature.js', 'export const x = 1\n')
  const llm = captureLlm('feat(core): add the feature\n\nExplain the motivation.\n')
  const operations = createOperations({ exec, services: services(llm) })
  const result = await operations.handle('aiCommit', {
    cwd: env.repo, sessionId: 'session-1', mode: 'quick',
  })
  assert.equal(result.mode, 'quick')
  assert.equal(result.subject, 'feat(core): add the feature')
  assert.equal(result.body, 'Explain the motivation.')
  assert.equal(result.model, 'fake/cheap')
  assert.equal(result.effort, 'low')
  assert.equal(result.fallback, false)
  assert.equal(llm.calls.length, 1)
  assert.equal(llm.calls[0].maxTokens, 600)
  assert.equal(llm.calls[0].reasoningEffort, 'low')
  assert.match(llm.calls[0].system, /Conventional Commits/)
  assert.match(llm.calls[0].messages[0].content[0].text, /src\/feature\.js/)
})

test('detailed AI commit sees untracked file content and uses a larger budget', async (t) => {
  const env = await createRepo()
  t.after(() => cleanup(env.base))
  await write(env.repo, 'docs/notes.md', 'UNTRACKED_MARKER_CONTENT\n')
  const llm = captureLlm('docs(notes): explain the sync contract\n\nAdd the missing notes.\n')
  const operations = createOperations({ exec, services: services(llm) })
  const result = await operations.handle('aiCommit', {
    cwd: env.repo, sessionId: 'session-1', mode: 'detailed',
  })
  assert.equal(result.mode, 'detailed')
  assert.equal(llm.calls[0].maxTokens, 1400)
  assert.match(llm.calls[0].system, /senior engineer/)
  assert.match(llm.calls[0].messages[0].content[0].text, /UNTRACKED_MARKER_CONTENT/)
})

test('an explicit cheaper model and effort override the session default', async (t) => {
  const env = await createRepo()
  t.after(() => cleanup(env.base))
  await write(env.repo, 'a.txt', 'a\n')
  const llm = captureLlm('chore: update a file\n')
  const operations = createOperations({ exec, services: services(llm) })
  const result = await operations.handle('aiCommit', {
    cwd: env.repo,
    sessionId: 'session-1',
    mode: 'quick',
    selection: { provider: 'fake', model: 'cheap' },
    effort: 'none',
  })
  assert.equal(result.effort, 'none')
  assert.equal(llm.calls[0].reasoningEffort, 'none')
  assert.equal(result.subject, 'chore: update a file')
})

test('unusable model output falls back to a deterministic conventional subject', async (t) => {
  const env = await createRepo()
  t.after(() => cleanup(env.base))
  await write(env.repo, 'a.txt', 'a\n')
  const llm = captureLlm('fix:')
  const operations = createOperations({ exec, services: services(llm) })
  const result = await operations.handle('aiCommit', {
    cwd: env.repo, sessionId: 'session-1', mode: 'quick',
  })
  assert.equal(result.fallback, true)
  assert.match(result.subject, /^chore: /)
  assert.equal(looksLikeSubject('fix:'), false)
})

test('missing AI service degrades to a deterministic fallback instead of failing the commit flow', async (t) => {
  const env = await createRepo()
  t.after(() => cleanup(env.base))
  await write(env.repo, 'a.txt', 'a\n')
  const operations = createOperations({ exec, services: () => ({}) })
  const result = await operations.handle('aiCommit', {
    cwd: env.repo, sessionId: 'session-1', mode: 'quick',
  })
  assert.equal(result.fallback, true)
  assert.match(result.warning || '', /AI|不可用/i)
  assert.match(result.subject, /^chore: /)
})

test('AI conflict resolution suggests content, validates it and applies it', async (t) => {
  const env = await createRepo()
  t.after(() => cleanup(env.base))
  const clone = await cloneRepo(env.base)
  const llm = captureLlm('## Sync\n\nThe client calls one sync operation: fetch, merge, push.\n\nConflicts are left to the user.\n')
  const operations = createOperations({ exec, services: services(llm) })
  const local = (op, params = {}) => operations.handle(op, { cwd: env.repo, ...params })
  const other = (op, params = {}) => operations.handle(op, { cwd: clone, ...params })

  await write(clone, 'README.md', '# remote\n')
  await other('commit', { message: 'fix: remote' })
  await other('sync')
  await write(env.repo, 'README.md', '# local\n')
  await local('commit', { message: 'fix: local' })
  const conflict = await local('sync')
  assert.equal(conflict.conflict, true)

  const suggested = await local('aiResolve', {
    path: 'README.md', sessionId: 'session-1', hint: 'keep both changes',
  })
  assert.equal(suggested.delete, false)
  assert.equal(suggested.deterministic, false)
  assert.match(suggested.suggested, /one sync operation/)
  assert.match(llm.calls[0].messages[0].content[0].text, /CURRENT BRANCH/)
  assert.match(llm.calls[0].messages[0].content[0].text, /INCOMING SIDE/)
  assert.equal(suggested.model, 'fake/cheap')

  const applied = await local('applyResolution', { path: 'README.md', content: suggested.suggested })
  assert.equal(applied.resolved, true)
  assert.equal(applied.unmerged, 0)
  assert.equal(await readFile(`${env.repo}/README.md`, 'utf8'), suggested.suggested)

  const snapshot = await local('snapshot')
  assert.equal(snapshot.status.conflicted.length, 0)
})

test('a truncated conflict resolution is rejected instead of writing half a file', async (t) => {
  const env = await createRepo()
  t.after(() => cleanup(env.base))
  const clone = await cloneRepo(env.base)
  const llm = captureLlm('## Sync\n\nhalf a file', { finish: 'max-tokens' })
  const operations = createOperations({ exec, services: services(llm) })
  const local = (op, params = {}) => operations.handle(op, { cwd: env.repo, ...params })
  const other = (op, params = {}) => operations.handle(op, { cwd: clone, ...params })

  await write(clone, 'README.md', '# remote\n')
  await other('commit', { message: 'fix: remote' })
  await other('sync')
  await write(env.repo, 'README.md', '# local\n')
  await local('commit', { message: 'fix: local' })
  await local('sync')

  const error = await local('aiResolve', { path: 'README.md', sessionId: 'session-1' }).catch((reason) => reason)
  assert.equal(error.code, 'ai-unavailable')
  assert.match(error.message, /截断/)
  const text = await readFile(`${env.repo}/README.md`, 'utf8')
  assert.match(text, /<<<<<<< /)
})
test('AI drafting reads staged diffs even before the repository has a first commit', async (t) => {
  const repo = await tempDir()
  t.after(() => cleanup(repo))
  await git(['init', '-q', '-b', 'main'], repo)
  await git(['config', 'user.email', 'a@b.c'], repo)
  await git(['config', 'user.name', 'A'], repo)
  await write(repo, 'first.txt', 'FIRST_COMMIT_MARKER\n')
  await git(['add', '-A'], repo)

  const llm = captureLlm('feat: add the first file\n')
  const operations = createOperations({ exec, services: services(llm) })
  const result = await operations.handle('aiCommit', {
    cwd: repo, sessionId: 'session-1', mode: 'quick',
  })
  assert.equal(result.subject, 'feat: add the first file')
  assert.match(llm.calls[0].messages[0].content[0].text, /FIRST_COMMIT_MARKER/)
})

test('AI commit context can be limited to the selected paths', async (t) => {
  const env = await createRepo()
  t.after(() => cleanup(env.base))
  await write(env.repo, 'docs/a.md', 'A_ONLY_MARKER\n')
  await write(env.repo, 'docs/b.md', 'B_EXCLUDED_MARKER\n')
  const llm = captureLlm('docs(a): describe the selected file\n')
  const operations = createOperations({ exec, services: services(llm) })
  const result = await operations.handle('aiCommit', {
    cwd: env.repo,
    sessionId: 'session-1',
    mode: 'detailed',
    paths: ['docs/a.md'],
  })
  assert.equal(result.subject, 'docs(a): describe the selected file')
  const prompt = llm.calls[0].messages[0].content[0].text
  assert.match(prompt, /A_ONLY_MARKER/)
  assert.doesNotMatch(prompt, /B_EXCLUDED_MARKER/)
  assert.doesNotMatch(prompt, /docs\/b\.md/)
})
