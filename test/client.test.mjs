import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'

/** Load the classic browser bundle with just enough React and host context to run apply(). */
async function loadClient() {
  const source = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
  let definition = null
  const registrations = []
  class Component { constructor(props) { this.props = props } }

  const React = {
    createElement() { return null },
    Fragment: Symbol('Fragment'),
    Component,
    useState() { return [null, function () {}] },
    useEffect() { return function () {} },
    useRef() { return { current: null } },
  }

  const workspaces = {
    list: {
      getSnapshot() {
        return { items: [{ workspaceId: 'ws-a', path: '/tmp/a', title: 'a', sessionIds: [] }], archivedSessionIds: [], pinnedSessionIds: [] }
      },
      subscribe() { return function () {} },
    },
  }

  let sidebarTab = null
  const ctx = {
    effect(fn) { return fn() },
    get(name) { return name === 'workspaces' ? workspaces : null },
    locale: {
      register() { return function () {} },
      bind() { return function (key) { return key } },
    },
    sidebarRightTabs: {
      register(tab) { sidebarTab = tab; return function () {} },
    },
    sidebarRight: { openTab() {} },
    slots: {
      inject(_name, fn) { return fn() },
      register(spec, component) {
        registrations.push({ spec, component })
        return function () {}
      },
    },
    sessions: {
      list: {
        getSnapshot() { return { byId: {} } },
        subscribe() { return function () {} },
      },
    },
  }

  runInNewContext(source, {
    window: { __ModuleLoader__: { load(value) { definition = value } }, localStorage: null },
    React,
    console,
  })
  assert.ok(definition, 'the bundle registered a module definition')
  const plugin = definition.factory((name) => {
    if (name === 'react') return React
    throw new Error('unexpected require: ' + name)
  })
  plugin.apply(ctx)
  return { plugin, registrations, sidebarTab }
}

test('the client registers the session tab and the global repository page', async () => {
  const { plugin, registrations, sidebarTab } = await loadClient()

  assert.ok(plugin.inject.includes('workspaces'))
  assert.equal(sidebarTab.id, 'wdx-git')
  assert.equal(typeof sidebarTab.guide[0].icon, 'function')

  const names = registrations.map((entry) => entry.spec.name + ':' + (entry.spec.key || entry.spec.id || ''))
  assert.ok(names.includes('main:wdx-git-global'))
  assert.ok(names.includes('sidebar.panellist:wdx-git-global'))
  assert.ok(names.includes('sidebar.right.pane.tab:wdx-git'))

  const main = registrations.find((entry) => entry.spec.name === 'main')
  assert.equal(typeof main.component, 'function')
  const sidebar = registrations.find((entry) => entry.spec.name === 'sidebar.panellist')
  assert.equal(sidebar.spec.order, 5)
  assert.equal(typeof sidebar.component, 'function')
})
