import test from 'node:test'
import assert from 'node:assert/strict'
import {
  cleanGitEnv,
  parseStatusV2,
  parseBranches,
  parseGraph,
  parseDiff,
  diffWords,
  parseCommitInfo,
  unquoteGitPath,
  relativeTime,
} from '../src/git.js'

test('cleanGitEnv tombstones inherited GIT_CONFIG_* and forces non-interactive git', () => {
  const env = cleanGitEnv({
    PATH: '/bin',
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'a.b',
    GIT_CONFIG_VALUE_0: 'c',
    KEEP: 'yes',
  })
  assert.equal(env.PATH, '/bin')
  assert.equal(env.KEEP, 'yes')
  assert.equal(env.GIT_CONFIG_COUNT, undefined)
  assert.equal(env.GIT_CONFIG_KEY_0, undefined)
  assert.equal(env.GIT_CONFIG_VALUE_0, undefined)
  assert.ok(Object.hasOwn(env, 'GIT_CONFIG_KEY_0'))
  assert.equal(env.GIT_TERMINAL_PROMPT, '0')
  assert.equal(env.GIT_PAGER, 'cat')
  assert.equal(env.LC_ALL, 'C')
})

test('parseStatusV2 reads branch headers, groups files and keeps both sides of a partial stage', () => {
  const hash = 'a'.repeat(40)
  const raw = [
    `# branch.oid ${hash}`,
    '# branch.head main',
    '# branch.upstream origin/main',
    '# branch.ab +1 -2',
    `1 .M N... 100644 100644 100644 ${hash} ${hash} src/a.js`,
    `1 M. N... 100644 100644 100644 ${hash} ${hash} src/b.js`,
    `2 R. N... 100644 100644 100644 ${hash} ${hash} R100 src/new.js`,
    'src/old.js',
    `u UU N... 100644 100644 100644 100644 ${hash} ${hash} ${hash} both.js`,
    '? new.txt',
    '! ignored.log',
  ].join('\0') + '\0'
  const parsed = parseStatusV2(raw)
  assert.equal(parsed.branch.oid, hash)
  assert.equal(parsed.branch.head, 'main')
  assert.equal(parsed.branch.upstream, 'origin/main')
  assert.equal(parsed.branch.ahead, 1)
  assert.equal(parsed.branch.behind, 2)
  assert.equal(parsed.entries.length, 5)
  assert.deepEqual(parsed.changes.staged.map((entry) => entry.path), ['src/b.js', 'src/new.js'])
  assert.deepEqual(parsed.changes.unstaged.map((entry) => entry.path), ['src/a.js'])
  assert.deepEqual(parsed.changes.untracked.map((entry) => entry.path), ['new.txt'])
  assert.deepEqual(parsed.changes.conflicted.map((entry) => entry.path), ['both.js'])
  assert.equal(parsed.changes.staged[1].oldPath, 'src/old.js')
})

test('parseStatusV2 understands an unborn branch', () => {
  const parsed = parseStatusV2('# branch.oid (initial)\0# branch.head main\0? a.txt\0')
  assert.equal(parsed.branch.initial, true)
  assert.equal(parsed.branch.oid, null)
  assert.equal(parsed.branch.head, 'main')
  assert.deepEqual(parsed.changes.untracked.map((entry) => entry.path), ['a.txt'])
})

test('parseBranches reads tracking metadata and skips remote HEAD', () => {
  const raw = [
    'refs/heads/main\x00main\x00abc\x00origin/main\x00[ahead 1, behind 2]\x003 hours ago\x00feat: x',
    'refs/remotes/origin/HEAD\x00origin\x00abc\x00\x00\x00\x00',
    'refs/remotes/origin/main\x00origin/main\x00abc\x00\x00\x00\x00',
    'refs/remotes/origin/fix\x00origin/fix\x00def\x00\x00[gone]\x00\x00fix: y',
  ].join('\n')
  const branches = parseBranches(raw)
  assert.equal(branches.length, 3)
  assert.deepEqual(branches[0], {
    name: 'main', kind: 'local', current: false, upstream: 'origin/main',
    ahead: 1, behind: 2, gone: false, commit: 'abc', subject: 'feat: x', date: '3 hours ago',
  })
  assert.equal(branches[1].name, 'origin/main')
  assert.equal(branches[2].gone, true)
})

test('parseGraph keeps lanes continuous and records merge edges', () => {
  const hash = (value) => value.padEnd(40, '0')
  const commits = [
    { full: hash('a'), short: 'a', parents: [hash('b')], refs: ['HEAD -> main', 'origin/main'], author: 'A', date: 'now', subject: 'a' },
    { full: hash('b'), short: 'b', parents: [hash('c'), hash('d')], refs: [], author: 'A', date: 'now', subject: 'b' },
    { full: hash('c'), short: 'c', parents: [hash('e')], refs: ['feat'], author: 'A', date: 'now', subject: 'c' },
    { full: hash('d'), short: 'd', parents: [hash('e')], refs: ['fix'], author: 'A', date: 'now', subject: 'd' },
    { full: hash('e'), short: 'e', parents: [], refs: [], author: 'A', date: 'now', subject: 'e' },
  ]
  const rows = parseGraph(commits.map((commit) => [
    commit.full,
    commit.parents.join(' '),
    commit.short,
    commit.author,
    commit.date,
    commit.refs.join(', '),
    commit.subject,
  ].join('\x1f')).join('\n'))
  assert.equal(rows.length, 5)
  assert.equal(rows[0].lane, 0)
  assert.equal(rows[1].lane, 0)
  assert.ok(rows[1].fromAbove)
  assert.ok(rows[1].joins.some((join) => join.kind === 'branch' && join.from === 0))
  assert.ok(rows[1].width >= 2)
  assert.ok(rows[2].trails.some((trail) => trail.from === 1))
  assert.equal(rows[2].refs[0], 'feat')
  assert.equal(rows[4].color >= 0, true)
})

test('parseGraph hides remote symbolic HEAD decorations', () => {
  const hash = 'b'.repeat(40)
  const row = parseGraph([
    hash, '', 'bbbbbbb', 'A', 'now', 'HEAD -> main, origin/main, origin/HEAD, origin/HEAD -> origin/main', 'subject',
  ].join('\x1f'))[0]
  assert.deepEqual(row.refs, ['HEAD -> main', 'origin/main'])
})

test('parseDiff splits files, counts lines, keeps rename/binary metadata and word fragments exact', () => {
  const raw = [
    'diff --git a/src/a.js b/src/a.js',
    'index 111..222 100644',
    '--- a/src/a.js',
    '+++ b/src/a.js',
    '@@ -1,3 +1,3 @@',
    ' const a = 1',
    '-const b = 2',
    '+const c = 3',
    ' const d = 4',
    'diff --git a/old.txt b/new.txt',
    'similarity index 100%',
    'rename from old.txt',
    'rename to new.txt',
    'diff --git a/img.png b/img.png',
    'index 333..444 100644',
    'Binary files a/img.png and b/img.png differ',
    '',
  ].join('\n')
  const parsed = parseDiff(raw)
  assert.equal(parsed.files.length, 3)
  assert.equal(parsed.additions, 1)
  assert.equal(parsed.deletions, 1)
  assert.equal(parsed.files[0].path, 'src/a.js')
  assert.equal(parsed.files[0].hunks.length, 1)
  const del = parsed.files[0].hunks[0].lines[1]
  const add = parsed.files[0].hunks[0].lines[2]
  assert.equal(del.inline.map((part) => part.text).join(''), del.text)
  assert.equal(add.inline.map((part) => part.text).join(''), add.text)
  assert.ok(del.inline.some((part) => part.changed && part.text.includes('b')))
  assert.equal(parsed.files[1].status, 'R')
  assert.equal(parsed.files[1].oldPath, 'old.txt')
  assert.equal(parsed.files[1].path, 'new.txt')
  assert.equal(parsed.files[2].binary, true)
})

test('diffWords handles CJK per character and degrades for huge inputs', () => {
  const parts = diffWords('修复登录问题', '修复注册问题')
  assert.equal(parts.before.map((part) => part.text).join(''), '修复登录问题')
  assert.equal(parts.after.map((part) => part.text).join(''), '修复注册问题')
  assert.ok(parts.before.some((part) => part.changed && part.text.includes('登')))
  const huge = 'a '.repeat(500)
  const degraded = diffWords(huge, huge + ' b')
  assert.equal(degraded.before.length, 1)
  assert.equal(degraded.before[0].changed, true)
})

test('parseCommitInfo separates subject and body', () => {
  const info = parseCommitInfo([
    'a'.repeat(40), 'aaaaaaa', 'Wen', 'wen@example.com', '1700000000', '2 hours ago',
    'HEAD -> main', 'b'.repeat(40), 'feat: subject\n\nbody line 1\nbody line 2',
  ].join('\x1f'))
  assert.equal(info.subject, 'feat: subject')
  assert.equal(info.body, 'body line 1\nbody line 2')
  assert.equal(info.parents[0], 'b'.repeat(40))
})

test('unquoteGitPath decodes C-style quoting and strips timestamps', () => {
  assert.equal(unquoteGitPath('"a\\tb\\n"'), 'a\tb\n')
  assert.equal(unquoteGitPath('a/b\t2024-01-01'), 'a/b')
})

test('relativeTime picks stable units', () => {
  assert.equal(relativeTime(Date.now() - 5000).unit, 'second')
  assert.equal(relativeTime(Date.now() - 5 * 60000).unit, 'minute')
  assert.equal(relativeTime(Date.now() - 3 * 3600000).unit, 'hour')
  assert.equal(relativeTime(Date.now() - 3 * 86400000).unit, 'day')
})