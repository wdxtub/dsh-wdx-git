(function () {
  var params = new URLSearchParams(location.search)
  var narrow = params.has('narrow')
  var conflictMode = params.has('conflict')
  var slowOverview = params.has('slow')
  var syncConflict = params.has('syncConflict')
  var backgroundDemo = params.has('background')
  var backgroundSeeded = false
  var demoTaskId = 'task-demo-1'
  var repoPath = '/Users/wdxtub/Documents/WhatThey/dsh-wdx-git'
  var otherPath = '/Users/wdxtub/Documents/WhatThey/wdxtub-blog'

  function backgroundTask(mode, status, extra) {
    var task = {
      id: demoTaskId, mode: mode, status: status, startedAt: Date.now(), finishedAt: null,
      pushed: false, merged: null, stashed: false, conflict: false, conflictFiles: [],
      stashHash: null, stashRestoreConflict: false, stashRestoreFailed: false,
      output: '', error: null, errorCode: null,
    }
    if (extra) {
      Object.keys(extra).forEach(function (key) { task[key] = extra[key] })
      task.finishedAt = Date.now()
    }
    return task
  }

  if (params.has('background') || params.has('syncConflict') || params.has('switchAway')
    || params.has('autoCommitPush')) {
    // Headless screenshots report the page as hidden, which the panel's polling
    // respects; these demos need the polling loops to run.
    Object.defineProperty(document, 'hidden', { configurable: true, get: function () { return false } })
  }
  var stage = document.getElementById('stage')
  if (narrow) stage.classList.add('narrow')
  var fixtures = window.__FIXTURES__
  var snapshot = conflictMode ? fixtures.conflictSnapshot : fixtures.snapshot
  var aheadOverride = params.get('ahead')
  var behindOverride = params.get('behind')
  if (aheadOverride !== null) snapshot.repo.ahead = Number(aheadOverride)
  if (behindOverride !== null) snapshot.repo.behind = Number(behindOverride)
  var registered = {}
  var dictionaries = null

  function interpolate(text, values) {
    if (!values) return text
    return String(text).replace(/\{(\w+)\}/g, function (match, key) {
      return Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : match
    })
  }

  var workspaces = {
    items: [
      { workspaceId: 'ws-git', path: repoPath, title: 'dsh-wdx-git', sessionIds: [] },
      { workspaceId: 'ws-blog', path: otherPath, title: 'wdxtub-blog', sessionIds: [] },
      { workspaceId: 'ws-notes', path: '/Users/wdxtub/Documents/notes', title: 'notes', sessionIds: [] },
    ],
    archivedSessionIds: [],
    pinnedSessionIds: [],
    state: 'ready',
    phase: 'ready',
    error: null,
  }
  var sessionsState = {
    byId: { 'session-1': { id: 'session-1', cwd: repoPath, title: 'dsh-wdx-git' } },
  }
  var sessionListeners = []
  var ctx = {
    effect: function (fn) { try { return fn() } catch (error) { console.error(error) } },
    get: function (name) {
      if (name === 'workspaces') {
        return {
          list: {
            getSnapshot: function () { return workspaces },
            subscribe: function () { return function () {} },
          },
        }
      }
      return null
    },
    locale: {
      register: function (ns, dicts) { dictionaries = dicts },
      bind: function () {
        return function (key, values) {
          var table = dictionaries && dictionaries.zh ? dictionaries.zh : {}
          return interpolate(table[key] || key, values)
        }
      },
    },
    sessions: {
      list: {
        getSnapshot: function () {
          return sessionsState
        },
        subscribe: function (listener) {
          sessionListeners.push(listener)
          return function () {
            sessionListeners = sessionListeners.filter(function (item) { return item !== listener })
          }
        },
      },
    },
    slots: {
      inject: function (name, fn) { try { fn() } catch (error) { console.error(error) } return function () {} },
      register: function (spec, component) {
        registered[spec.name + ':' + (spec.key || spec.id || '')] = component
        return function () {}
      },
    },
    sidebarRightTabs: {
      register: function (definition) { window.__TAB_DEF__ = definition; return function () {} },
    },
    sidebarRight: {
      openTab: function (kind) { console.log('[harness] openTab', kind) },
    },
  }

  function delay(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms) }) }

  /** Point the session at another repository, the way switching sessions does. */
  function moveSession(path, title) {
    sessionsState = { byId: { 'session-1': { id: 'session-1', cwd: path, title: title } } }
    sessionListeners.forEach(function (listener) { listener() })
  }

  function ok(data) {
    return { status: 200, ok: true, json: async function () { return { ok: true, data: data } } }
  }
  function fail(message, code) {
    return { status: 200, ok: true, json: async function () { return { ok: false, error: { code: code || 'git-failed', message: message } } } }
  }

  window.fetch = async function (url, options) {
    if (String(url).indexOf('/api/wdx-git') === -1) return new Response('not found', { status: 404 })
    var request = JSON.parse(options.body || '{}')
    var op = request.op
    await delay(op === 'aiCommit' || op === 'aiResolve' ? 650 : 90)
    if (op === 'overview') {
      if (slowOverview) await delay(1400)
      return ok({
        at: Date.now(),
        repos: [
          { path: '/Users/wdxtub/Documents/WhatThey/dsh-wdx-git', isRepo: true, root: '/Users/wdxtub/Documents/WhatThey/dsh-wdx-git', name: 'dsh-wdx-git', branch: 'main', detached: false, upstream: 'origin/main', ahead: 0, behind: 0, changed: 2, clean: false, staged: 0, unstaged: 1, untracked: 1, conflicted: 0, error: null },
          { path: '/Users/wdxtub/Documents/WhatThey/wdxtub-blog', isRepo: true, root: '/Users/wdxtub/Documents/WhatThey/wdxtub-blog', name: 'wdxtub-blog', branch: 'draft/global-git', detached: false, upstream: 'origin/draft/global-git', ahead: 2, behind: 1, changed: 0, clean: true, staged: 0, unstaged: 0, untracked: 0, conflicted: 0, error: null },
          { path: '/Users/wdxtub/Documents/notes', isRepo: false, error: 'not a git repository', code: 'not-a-repo' },
        ],
      })
    }
    if (op === 'snapshot') {
      if (backgroundDemo && !backgroundSeeded) {
        backgroundSeeded = true
        snapshot.background = backgroundTask('push', 'running')
        setTimeout(function () {
          snapshot.background = backgroundTask('push', 'done', {
            pushed: true, output: '(demo) push complete',
          })
        }, 1500)
      }
      // Later snapshots keep reporting whatever the task reached, so the panel
      // sees running and then the finished task. A different repository reports
      // its own state and no task of ours.
      var shown = snapshot
      if (request.cwd && request.cwd !== repoPath) {
        shown = Object.assign({}, snapshot, {
          repo: Object.assign({}, snapshot.repo, {
            path: request.cwd, root: request.cwd, name: request.cwd.split('/').pop(),
          }),
          background: null,
        })
      }
      return ok(shown)
    }
    if (op === 'graph') return ok(fixtures.graph)
    if (op === 'models') return ok(fixtures.models)
    if (op === 'commitInfo') return ok(fixtures.commitInfo)
    if (op === 'conflictInfo') return ok(fixtures.conflictInfo)
    if (op === 'diff') {
      if (request.mode === 'commit') return ok(fixtures.commitDiff)
      if (request.path === 'docs/PROTOCOL.md') return ok(fixtures.conflictDiff)
      if (request.mode === 'staged') return ok(fixtures.stagedDiff)
      return ok(fixtures.worktreeDiff)
    }
    if (op === 'aiCommit') {
      return ok(fixtures.aiCommit)
    }
    if (op === 'aiResolve') {
      if (request.apply) {
        snapshot.status.conflicted = snapshot.status.conflicted.filter(function (entry) {
          return entry.path !== request.path
        })
        return ok({
          path: request.path, resolved: true, deleted: false, unmerged: snapshot.status.conflicted.length,
          deterministic: false, route: 'whole', model: fixtures.aiResolve.model, warning: '',
        })
      }
      return ok(fixtures.aiResolve)
    }
    if (op === 'applyResolution' || op === 'takeSide' || op === 'markResolved') {
      snapshot.status.conflicted = []
      return ok({ path: request.path, resolved: true, deleted: !!request.delete, unmerged: 0, output: '(demo) conflict resolved' })
    }
    if (op === 'commit') {
      snapshot.status = { clean: true, staged: [], unstaged: [], untracked: [], conflicted: [] }
      snapshot.repo.head = 'abc1234'
      snapshot.repo.ahead = 1
      return ok({ hash: 'abc1234', subject: request.message.split('\n')[0], branch: 'main', output: '[main abc1234] ' + request.message.split('\n')[0] })
    }
    if (op === 'sync' || op === 'pull' || op === 'push' || op === 'fetch') {
      // The host answers at once and finishes the sync detached from the request,
      // reported through the following snapshots.
      if (op !== 'fetch' && request.background === true) {
        var mode = request.mode || 'sync'
        var runningTask = backgroundTask(mode, 'running')
        snapshot.background = runningTask
        setTimeout(function () {
          snapshot.background = syncConflict
            ? backgroundTask(mode, 'conflict', {
              merged: 'merge', conflict: true, conflictFiles: ['docs/PROTOCOL.md'],
              output: '(demo) merge conflict',
            })
            : backgroundTask(mode, 'done', {
              merged: 'merge', pushed: true, output: '(demo) sync complete',
            })
          if (syncConflict) {
            snapshot.status.conflicted = [{ path: 'docs/PROTOCOL.md', status: 'UU', x: 'U', y: 'U', oldPath: null }]
          } else {
            snapshot.repo.ahead = 0
            snapshot.repo.behind = 0
          }
        }, 1500)
        return ok({ background: true, task: runningTask })
      }
      if (syncConflict && op !== 'fetch') {
        snapshot.status.conflicted = [{ path: 'docs/PROTOCOL.md', status: 'UU', x: 'U', y: 'U', oldPath: null }]
        return ok({
          mode: request.mode || 'sync', branch: 'main', remote: 'origin', upstream: 'origin/main',
          ahead: 0, behind: 0, hasUpstream: true, merged: 'merge', pushed: false,
          stashed: false, conflict: true, conflictFiles: ['docs/PROTOCOL.md'], steps: [],
          output: '(demo) merge conflict', at: Date.now(),
        })
      }
      snapshot.repo.ahead = 0
      snapshot.repo.behind = 0
      return ok({
        mode: request.mode || 'sync', branch: 'main', remote: 'origin', upstream: 'origin/main',
        ahead: 0, behind: 0, hasUpstream: true, merged: op === 'fetch' ? null : 'merge', pushed: op !== 'fetch',
        stashed: false, conflict: false, conflictFiles: [], steps: [], output: '(demo) ' + op + ' complete', at: Date.now(),
      })
    }
    if (op === 'setCommitPrompt') return ok({ prompt: request.prompt || '' })
    if (op === 'stage' || op === 'unstage' || op === 'discard' || op === 'stashPush' || op === 'stashPop' || op === 'stashDrop'
      || op === 'switchBranch' || op === 'createBranch' || op === 'deleteBranch' || op === 'abortOperation' || op === 'continueOperation') {
      return ok({ output: '(demo) ' + op + ' ok', branch: request.name || 'main' })
    }
    return fail('demo: unknown op ' + op)
  }

  console.log('[harness] plugin def', window.__PLUGIN_DEF__)
  var plugin = window.__PLUGIN_DEF__.factory(function (name) {
    if (name === 'react') return window.React
    throw new Error('harness cannot require ' + name)
  })
  plugin.apply(ctx)

  var global = params.has('global')
  var Body = registered[global ? 'main:wdx-git-global' : 'sidebar.right.pane.tab:wdx-git']
  if (!Body) {
    document.getElementById('stage').textContent = 'panel body was not registered'
    return
  }
  var root = ReactDOM.createRoot(stage)
  root.render(React.createElement(Body, global ? {} : { sessionId: 'session-1' }))
  if (params.has('autoRefresh')) {
    setTimeout(function () {
      var button = document.querySelector('.wx-global-refresh')
      if (button) button.click()
    }, 900)
  }
  if (params.has('autoSync')) {
    setTimeout(function () {
      var button = document.querySelector('.wx-sync-cell')
      if (button) button.click()
    }, 900)
  }
  if (params.has('autoCommitPush')) {
    // The reported bug: commit with "push after commit" on, then switch to
    // another repository. The push must keep running and report on the way back.
    setTimeout(function () {
      var box = document.querySelector('.wx-commit-options input[type="checkbox"]')
      if (box && !box.checked) box.click()
      var input = document.querySelector('.wx-summary-input')
      if (input) {
        var setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
        setter.call(input, 'feat: background push demo')
        input.dispatchEvent(new Event('input', { bubbles: true }))
      }
      setTimeout(function () {
        var button = document.querySelector('.wx-commit-btn')
        if (button) button.click()
      }, 300)
    }, 1200)
  }
  if (params.has('switchAway')) {
    // Leave the repository while the background task is running, come back later,
    // and check that the finished task is reported on the way back.
    setTimeout(function () { moveSession(otherPath, 'wdxtub-blog') }, 2000)
    setTimeout(function () { moveSession(repoPath, 'dsh-wdx-git') }, 6000)
  }
  setTimeout(function () { window.__READY__ = true }, 700)
})()