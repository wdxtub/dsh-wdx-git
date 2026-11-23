import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'

/**
 * Load the bundle, capture the controller from the registered Git tab component,
 * and give every RPC a controllable fetch. Only the controller is used here; no
 * component is rendered.
 */
async function loadController() {
  const source = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
  let definition = null
  let tabComponent = null
  const pending = {}
  let snapshotPrompt = ''
  const controllable = new Set(['aiCommit', 'commit', 'discard', 'fetch', 'setCommitPrompt', 'switchBranch'])

  function json(data) {
    return { json: async () => ({ ok: true, data }) }
  }

  const fetch = (url, options = {}) => {
    const body = JSON.parse(String(options.body || '{}'))
    if (controllable.has(body.op)) {
      return new Promise((resolve) => { pending[body.op] = resolve })
    }
    if (body.op === 'snapshot') {
      return Promise.resolve(json({
        repo: { isRepo: true, root: '/repo-b', name: 'repo-b', hasRemote: true },
        branches: [], remotes: [], status: null, stashes: [], operation: null,
        user: { name: '', email: '' }, commitPrompt: snapshotPrompt, background: null,
      }))
    }
    if (body.op === 'graph') return Promise.resolve(json({ commits: [], all: true }))
    return Promise.resolve(json({}))
  }

  function createElement(type, props, ...children) {
    const merged = Object.assign({}, props || {})
    if (children.length === 1) merged.children = children[0]
    else if (children.length > 1) merged.children = children
    return { type, props: merged }
  }

  const React = {
    createElement,
    Fragment: Symbol('Fragment'),
    Component: class Component { constructor(props) { this.props = props } },
    useState(value) { return [typeof value === 'function' ? value() : value, function () {}] },
    useEffect() { return function () {} },
    useRef(value) { return { current: value } },
  }

  const ctx = {
    effect(fn) { return fn() },
    get() { return null },
    locale: {
      register() { return function () {} },
      bind() { return function (key) { return key } },
    },
    sidebarRightTabs: { register() { return function () {} } },
    sidebarRight: { openTab() {} },
    slots: {
      inject(name, fn) {
        const registered = fn()
        if (name === 'sidebar.right.pane.tab' && registered && registered.component) {
          tabComponent = registered.component
        }
        return registered
      },
      register(_spec, component) { return { component } },
    },
    sessions: {
      list: { getSnapshot() { return { byId: {} } }, subscribe() { return function () {} } },
    },
  }

  runInNewContext(source, {
    window: { __ModuleLoader__: { load(value) { definition = value } }, localStorage: null },
    React,
    fetch,
    // Toast timers are irrelevant here; stubs keep the test from waiting 6.5s.
    setTimeout() { return 0 },
    clearTimeout() {},
    console,
  })
  assert.ok(definition, 'the bundle registered a module definition')
  const plugin = definition.factory((name) => {
    if (name === 'react') return React
    throw new Error('unexpected require: ' + name)
  })
  plugin.apply(ctx)
  assert.ok(tabComponent, 'the Git tab component was registered')

  const element = tabComponent({ sessionId: 'session-1' })
  function findController(candidate) {
    if (!candidate || typeof candidate !== 'object') return null
    if (candidate.props && candidate.props.controller) return candidate.props.controller
    const children = candidate.props && candidate.props.children
    if (Array.isArray(children)) {
      for (const child of children) {
        const found = findController(child)
        if (found) return found
      }
      return null
    }
    return findController(children)
  }
  const controller = findController(element)
  assert.ok(controller, 'the controller reached GitPanel')
  return {
    controller,
    setSnapshotPrompt(value) { snapshotPrompt = value },
    resolve(op, output) {
      assert.ok(pending[op], `${op} RPC was issued`)
      pending[op]({ json: async () => ({ ok: true, data: output }) })
    },
  }
}

function seedRepoA(controller) {
  controller.store.set({
    cwd: '/repo-a',
    sessionId: 'session-1',
    snapshot: {
      repo: { isRepo: true, root: '/repo-a', branch: 'main', hasRemote: true, detached: false },
      status: {
        clean: false,
        staged: [{ path: 'a.txt', status: 'M', x: 'M', y: '.' }],
        unstaged: [], untracked: [], conflicted: [],
      },
      operation: null,
    },
    excluded: [],
    busy: null,
    bgTask: null,
    aiConfig: { provider: '', model: '', effort: 'auto' },
  })
}

test('an AI message generated in repo A is applied when the panel stays there', async () => {
  const { controller, resolve } = await loadController()
  seedRepoA(controller)

  const pending = controller.generateMessage()
  resolve('aiCommit', { subject: 'feat: generated', body: 'why', model: 'fake/cheap', fallback: false, warning: '' })
  await pending

  assert.equal(controller.store.get().cwd, '/repo-a')
  assert.equal(controller.store.get().subject, 'feat: generated')
  assert.equal(controller.store.get().aiGenerating, false)
})

test('an AI message generated in repo A is not applied after switching to repo B', async () => {
  const { controller, resolve } = await loadController()
  seedRepoA(controller)

  const pending = controller.generateMessage()
  controller.attach('/repo-b', 'session-2')
  resolve('aiCommit', { subject: 'leak', body: 'leak body', model: 'fake/cheap', fallback: false, warning: '' })
  await pending

  assert.equal(controller.store.get().cwd, '/repo-b')
  assert.equal(controller.store.get().subject, '')
  assert.equal(controller.store.get().body, '')
  assert.equal(controller.store.get().aiGenerating, false)
})

function switchToB(controller, patch) {
  controller.attach('/repo-b', 'session-2')
  controller.store.set(Object.assign({ cwd: '/repo-b', sessionId: 'session-2' }, patch || {}))
}

test('a commit completed in repo A does not clear repo B’s form', async () => {
  const { controller, resolve } = await loadController()
  seedRepoA(controller)
  controller.store.set({ subject: 'a message', body: 'a body', pushAfter: false })

  const pending = controller.commit()
  switchToB(controller, {
    subject: 'b draft', body: 'b body', excluded: ['keep.txt'],
    selected: { kind: 'file', group: 'staged', path: 'keep.txt', mode: 'staged' },
  })
  resolve('commit', { hash: 'abc1234', subject: 'a', branch: 'main', output: '' })
  await pending

  assert.equal(controller.store.get().subject, 'b draft')
  assert.equal(controller.store.get().body, 'b body')
  assert.deepEqual(controller.store.get().excluded, ['keep.txt'])
  assert.equal(controller.store.get().selected.path, 'keep.txt')
  assert.equal(controller.store.get().toast, null)
})

test('saving a prompt in repo A does not write into repo B', async () => {
  const { controller, resolve, setSnapshotPrompt } = await loadController()
  seedRepoA(controller)
  setSnapshotPrompt('B PROMPT')
  controller.store.set({ settingsOpen: true })

  const pending = controller.saveSettings({ provider: '', model: '', effort: 'auto' }, 'A PROMPT', true, false)
  controller.attach('/repo-b', 'session-2')
  await new Promise((resolve) => setImmediate(resolve))
  controller.store.set({ settingsOpen: true })
  resolve('setCommitPrompt', { prompt: 'A PROMPT' })
  await pending

  assert.equal(controller.store.get().snapshot.commitPrompt, 'B PROMPT')
  assert.equal(controller.store.get().settingsOpen, true)
})

test('discarding in repo A does not clear repo B’s selection', async () => {
  const { controller, resolve } = await loadController()
  seedRepoA(controller)

  const pending = controller.discard('worktree', { path: 'a.txt' })
  switchToB(controller, {
    excluded: ['keep.txt'],
    selected: { kind: 'file', group: 'staged', path: 'keep.txt', mode: 'staged' },
  })
  resolve('discard', { output: '' })
  await pending

  assert.equal(controller.store.get().selected.path, 'keep.txt')
  assert.deepEqual(controller.store.get().excluded, ['keep.txt'])
  assert.equal(controller.store.get().toast, null)
})

test('a fetch completed in repo A does not update repo B’s fetch time', async () => {
  const { controller, resolve } = await loadController()
  seedRepoA(controller)
  controller.store.set({ lastFetchedAt: 111 })

  const pending = controller.fetch()
  switchToB(controller, { lastFetchedAt: 111 })
  resolve('fetch', { output: '', at: 222 })
  await pending

  assert.equal(controller.store.get().lastFetchedAt, 111)
  assert.equal(controller.store.get().toast, null)
})

test('a stale completion does not clear the new repository’s busy state', async () => {
  const { controller, resolve } = await loadController()
  seedRepoA(controller)

  const aiPending = controller.generateMessage()
  switchToB(controller)
  const fetchPending = controller.fetch()
  assert.equal(controller.store.get().busy, 'fetch')

  resolve('aiCommit', { subject: 'leak', body: '', model: 'fake/cheap', fallback: false, warning: '' })
  await aiPending
  assert.equal(controller.store.get().busy, 'fetch')

  resolve('fetch', { output: '', at: 1 })
  await fetchPending
  assert.equal(controller.store.get().busy, null)
})

test('a stale completion after switching away and back does not clear a new operation', async () => {
  const { controller, resolve } = await loadController()
  seedRepoA(controller)

  const aiPending = controller.generateMessage()
  switchToB(controller)
  switchToB(controller)
  controller.attach('/repo-a', 'session-1')
  controller.store.set({ cwd: '/repo-a', sessionId: 'session-1' })

  const fetchPending = controller.fetch()
  assert.equal(controller.store.get().busy, 'fetch')

  resolve('aiCommit', { subject: 'leak', body: '', model: 'fake/cheap', fallback: false, warning: '' })
  await aiPending
  assert.equal(controller.store.get().busy, 'fetch')
  assert.equal(controller.store.get().subject, '')

  resolve('fetch', { output: '', at: 1 })
  await fetchPending
  assert.equal(controller.store.get().busy, null)
})
