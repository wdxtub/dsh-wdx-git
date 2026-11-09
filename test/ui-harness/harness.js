(function () {
  var params = new URLSearchParams(location.search)
  var narrow = params.has('narrow')
  var conflictMode = params.has('conflict')
  var stage = document.getElementById('stage')
  if (narrow) stage.classList.add('narrow')
  var fixtures = window.__FIXTURES__
  var snapshot = conflictMode ? fixtures.conflictSnapshot : fixtures.snapshot
  var registered = {}
  var dictionaries = null

  function interpolate(text, values) {
    if (!values) return text
    return String(text).replace(/\{(\w+)\}/g, function (match, key) {
      return Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : match
    })
  }

  var ctx = {
    effect: function (fn) { try { return fn() } catch (error) { console.error(error) } },
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
          return { byId: { 'session-1': { id: 'session-1', cwd: '/Users/wdxtub/Documents/WhatThey/dsh-wdx-git', title: 'dsh-wdx-git' } } }
        },
        subscribe: function () { return function () {} },
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
    if (op === 'snapshot') return ok(snapshot)
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
    if (op === 'aiResolve') return ok(fixtures.aiResolve)
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

  var Body = registered['sidebar.right.pane.tab:wdx-git']
  if (!Body) {
    document.getElementById('stage').textContent = 'tab body was not registered'
    return
  }
  var root = ReactDOM.createRoot(stage)
  root.render(React.createElement(Body, { sessionId: 'session-1' }))
  setTimeout(function () { window.__READY__ = true }, 700)
})()