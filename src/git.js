/**
 * Git plumbing: child-process environment, error type and pure output parsers.
 *
 * Everything in this file is deterministic and side-effect free (besides reading
 * `process.env`), so it can be unit tested without a running DSH host.
 */

/** Failure raised by a git command or by request validation. */
export class GitError extends Error {
  /**
   * @param {string} message human-readable message
   * @param {{code?: string, stderr?: string, stdout?: string, exitCode?: number|null, data?: unknown}} [detail]
   */
  constructor(message, detail = {}) {
    super(message)
    this.name = 'GitError'
    this.code = detail.code ?? 'git-failed'
    this.stderr = detail.stderr ?? ''
    this.stdout = detail.stdout ?? ''
    this.exitCode = detail.exitCode ?? null
    this.data = detail.data
  }
}

/**
 * Build the environment handed to git subprocesses.
 *
 * DSH merges explicit env entries over the parent environment. A `GIT_CONFIG_*`
 * block leaked into this machine's parent env is malformed (COUNT without KEY_0),
 * and simply omitting the key does not remove it — tombstones (`undefined`) do.
 * We also force non-interactive, pager-free, locale-stable behaviour.
 *
 * @param {NodeJS.ProcessEnv} [source]
 * @returns {NodeJS.ProcessEnv}
 */
export function cleanGitEnv(source = process.env) {
  /** @type {NodeJS.ProcessEnv} */
  const env = {}
  for (const [key, value] of Object.entries(source ?? {})) {
    if (key === 'GIT_CONFIG_COUNT' || /^GIT_CONFIG_(KEY|VALUE)_\d+$/.test(key)) {
      env[key] = undefined
      continue
    }
    if (value !== undefined) env[key] = value
  }
  // Explicit tombstones for every slot a config-injection caller might have used.
  for (let index = 0; index < 24; index += 1) {
    env[`GIT_CONFIG_KEY_${index}`] = undefined
    env[`GIT_CONFIG_VALUE_${index}`] = undefined
  }
  env.GIT_CONFIG_COUNT = undefined
  env.GIT_TERMINAL_PROMPT = '0'
  env.GIT_PAGER = 'cat'
  env.GIT_OPTIONAL_LOCKS = '0'
  env.GIT_EDITOR = 'true'
  env.GIT_MERGE_AUTOEDIT = 'no'
  env.LC_ALL = 'C'
  env.LANG = 'C'
  return env
}

/**
 * Parse the dictionary emitted by macOS `scutil --proxy`.
 *
 * The output is a nested dictionary with `Key : Value` lines; `ExceptionsList`
 * is an array. We only need the boolean/port/host fields used by git.
 *
 * @param {string} text
 * @returns {{
 *   http: {enabled:boolean, host:string, port:string},
 *   https: {enabled:boolean, host:string, port:string},
 *   socks: {enabled:boolean, host:string, port:string},
 *   exceptions: string[]
 * }}
 */
export function parseScutilProxy(text) {
  const values = Object.create(null)
  const exceptions = []
  let inExceptions = false
  for (const rawLine of String(text ?? '').split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line === '') continue
    if (/^ExceptionsList\s*:/.test(line)) {
      inExceptions = true
      continue
    }
    if (inExceptions) {
      if (/^\}\s*$/.test(line)) {
        inExceptions = false
        continue
      }
      const item = line.match(/^\d+\s*:\s*(.+)$/)
      if (item) exceptions.push(item[1].trim())
      continue
    }
    const pair = line.match(/^([A-Za-z]+)\s*:\s*(.+)$/)
    if (!pair) continue
    values[pair[1]] = pair[2].trim()
  }
  const group = (prefix) => ({
    enabled: values[`${prefix}Enable`] === '1',
    host: values[`${prefix}Proxy`] || '',
    port: values[`${prefix}Port`] || '',
  })
  return {
    http: group('HTTP'),
    https: group('HTTPS'),
    socks: group('SOCKS'),
    exceptions,
  }
}

function normalizeProxyException(raw) {
  const value = String(raw ?? '').trim()
  if (value === '') return ''
  if (value.startsWith('*.')) return value.slice(1) // *.local -> .local
  if (value.startsWith('*')) return value.slice(1) // *example.com -> example.com
  if (value.endsWith('.*')) {
    const prefix = value.slice(0, -2)
    if (prefix === '127') return '127.0.0.1'
    if (prefix === '10') return '10.0.0.0/8'
    if (prefix === '192.168') return '192.168.0.0/16'
    if (/^172\.(1[6-9]|2\d|3[01])$/.test(prefix)) return '172.16.0.0/12'
    return ''
  }
  if (value.includes('*')) return ''
  return value
}

function mergeNoProxy(existing, exceptions) {
  const values = []
  const push = (value) => {
    const normalized = String(value ?? '').trim()
    if (normalized !== '' && values.indexOf(normalized) === -1) values.push(normalized)
  }
  for (const value of String(existing ?? '').split(',')) push(value)
  for (const value of ['localhost', '127.0.0.1', '::1', '.local']) push(value)
  for (const value of exceptions) push(normalizeProxyException(value))
  return values.join(',')
}

/**
 * Convert macOS system proxy settings into the env vars libcurl understands.
 * An explicit proxy from the parent environment always wins, and `NO_PROXY=*`
 * means "never proxy" so we leave the environment untouched.
 *
 * @param {string} text output of `scutil --proxy`
 * @param {NodeJS.ProcessEnv} [source]
 * @returns {Record<string, string>}
 */
export function proxyEnvFromScutil(text, source = process.env) {
  const env = source ?? {}
  if (
    env.HTTPS_PROXY || env.https_proxy || env.HTTP_PROXY || env.http_proxy
    || env.ALL_PROXY || env.all_proxy
  ) return {}
  const noProxy = String(env.NO_PROXY ?? env.no_proxy ?? '')
  if (noProxy.split(',').some((item) => item.trim() === '*')) return {}

  const config = parseScutilProxy(text)
  const result = {}
  const http = config.http.enabled && config.http.host && config.http.port
    ? `http://${config.http.host}:${config.http.port}`
    : ''
  const https = config.https.enabled && config.https.host && config.https.port
    ? `http://${config.https.host}:${config.https.port}`
    : ''
  if (https !== '') {
    result.HTTPS_PROXY = https
    result.https_proxy = https
  }
  if (http !== '') {
    result.HTTP_PROXY = http
    result.http_proxy = http
  }
  if (https === '' && http === '' && config.socks.enabled && config.socks.host && config.socks.port) {
    const socks = `socks5://${config.socks.host}:${config.socks.port}`
    result.ALL_PROXY = socks
    result.all_proxy = socks
  }
  if (Object.keys(result).length === 0) return {}
  const merged = mergeNoProxy(noProxy, config.exceptions)
  if (merged !== '') {
    result.NO_PROXY = merged
    result.no_proxy = merged
  }
  return result
}

/** Collapse arbitrary git output into a short single block. */
export function brief(text, max = 2400) {
  const value = String(text ?? '').trim()
  if (value.length <= max) return value
  return `${value.slice(0, max)}…`
}

/**
 * Turn a failed command result into a GitError.
 * @param {string[]} args args without the leading `git`
 * @param {{code: number|null, stdout: string, stderr: string}} result
 */
export function commandFailure(args, result) {
  const detail = [result.stderr, result.stdout].filter(Boolean).join('\n')
  return new GitError(`git ${args.join(' ')} 失败：${brief(detail) || '无输出'}`, {
    code: 'git-failed',
    stderr: result.stderr,
    stdout: result.stdout,
    exitCode: result.code,
  })
}

/**
 * Parse `git status --porcelain=v2 -z --branch --untracked-files=all`.
 *
 * Header records (`# branch.*`) and ordinary entries are all NUL terminated.
 * Rename entries (`2 ...`) carry the original path as the following record.
 *
 * @param {string} raw
 */
export function parseStatusV2(raw) {
  const records = String(raw ?? '').split('\0')
  const branch = {
    oid: null,
    head: null,
    upstream: null,
    ahead: 0,
    behind: 0,
    initial: false,
    detached: false,
  }
  const entries = []
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]
    if (record === '') continue
    if (record.startsWith('# ')) {
      const body = record.slice(2)
      if (body.startsWith('branch.oid ')) {
        const value = body.slice('branch.oid '.length).trim()
        branch.initial = value === '(initial)'
        branch.oid = branch.initial ? null : value
      } else if (body.startsWith('branch.head ')) {
        const value = body.slice('branch.head '.length).trim()
        branch.detached = value === '(detached)'
        branch.head = branch.detached ? null : value
      } else if (body.startsWith('branch.upstream ')) {
        branch.upstream = body.slice('branch.upstream '.length).trim() || null
      } else if (body.startsWith('branch.ab ')) {
        const match = /\+(\d+)\s+-(\d+)/.exec(body)
        if (match) {
          branch.ahead = Number(match[1])
          branch.behind = Number(match[2])
        }
      }
      continue
    }
    if (record.startsWith('? ')) {
      entries.push({ kind: 'untracked', path: record.slice(2), oldPath: null, x: '?', y: '?' })
      continue
    }
    if (record.startsWith('! ')) continue
    if (record.startsWith('1 ')) {
      const match = /^1 (..) \S+ \S+ \S+ \S+ \S+ \S+ (.*)$/s.exec(record)
      if (!match) continue
      entries.push({ kind: 'ordinary', path: match[2], oldPath: null, x: match[1][0], y: match[1][1] })
      continue
    }
    if (record.startsWith('2 ')) {
      const match = /^2 (..) \S+ \S+ \S+ \S+ \S+ \S+ \S+ (.*)$/s.exec(record)
      if (!match) continue
      const oldPath = records[index + 1] ?? null
      index += 1
      entries.push({ kind: 'renamed', path: match[2], oldPath, x: match[1][0], y: match[1][1] })
      continue
    }
    if (record.startsWith('u ')) {
      const match = /^u (..) \S+ \S+ \S+ \S+ \S+ \S+ \S+ \S+ (.*)$/s.exec(record)
      if (!match) continue
      entries.push({ kind: 'conflict', path: match[2], oldPath: null, x: match[1][0], y: match[1][1] })
    }
  }
  return { branch, entries, changes: classifyEntries(entries) }
}

/**
 * Split status entries into the four groups the panel renders.
 * A tracked file can appear in both `staged` and `unstaged` (partially staged).
 * @param {Array<{kind: string, path: string, oldPath: string|null, x: string, y: string}>} entries
 */
export function classifyEntries(entries) {
  const staged = []
  const unstaged = []
  const untracked = []
  const conflicted = []
  for (const entry of entries) {
    const base = { path: entry.path, oldPath: entry.oldPath ?? null }
    if (entry.kind === 'conflict') {
      conflicted.push({ ...base, status: `${entry.x}${entry.y}`, x: entry.x, y: entry.y })
      continue
    }
    if (entry.kind === 'untracked') {
      untracked.push({ ...base, status: '?', x: '?', y: '?' })
      continue
    }
    if (entry.x !== '.') {
      staged.push({ ...base, status: entry.x, x: entry.x, y: entry.y })
    }
    if (entry.y !== '.') {
      unstaged.push({ ...base, status: entry.y, x: entry.x, y: entry.y })
    }
  }
  return { staged, unstaged, untracked, conflicted }
}

/**
 * Parse `git for-each-ref` records.
 * Format fields: refname, short, short oid, upstream, track, relative date, subject.
 * @param {string} raw
 */
export function parseBranches(raw) {
  const branches = []
  for (const line of String(raw ?? '').split('\n')) {
    if (line.trim() === '') continue
    const fields = line.split('\0')
    if (fields.length < 7) continue
    const [refname, name, commit, upstream, track, date, ...rest] = fields
    if (!refname || !name) continue
    let kind = null
    if (refname.startsWith('refs/heads/')) kind = 'local'
    else if (refname.startsWith('refs/remotes/')) kind = 'remote'
    if (!kind) continue
    if (kind === 'remote' && (name.endsWith('/HEAD') || !name.includes('/'))) continue
    const tracking = parseTrack(track)
    branches.push({
      name,
      kind,
      current: false,
      upstream: upstream || null,
      ahead: tracking.ahead,
      behind: tracking.behind,
      gone: tracking.gone,
      commit: commit || '',
      subject: rest.join('\0').trim(),
      date: date || '',
    })
  }
  return branches
}

/** Parse `%(upstream:track)` such as `[ahead 1, behind 2]` or `[gone]`. */
export function parseTrack(track) {
  const value = String(track ?? '')
  const ahead = /ahead (\d+)/.exec(value)
  const behind = /behind (\d+)/.exec(value)
  return {
    ahead: ahead ? Number(ahead[1]) : 0,
    behind: behind ? Number(behind[1]) : 0,
    gone: value.includes('gone'),
  }
}

/**
 * Parse `git remote -v`.
 * @param {string} raw
 */
export function parseRemotes(raw) {
  const seen = new Map()
  for (const line of String(raw ?? '').split('\n')) {
    const match = /^(\S+)\s+(\S+)\s+\((fetch|push)\)$/.exec(line.trim())
    if (!match) continue
    if (!seen.has(match[1])) seen.set(match[1], match[2])
  }
  return [...seen.entries()].map(([name, url]) => ({ name, url }))
}

/**
 * Parse `git stash list --format=%gd%x00%s`.
 * @param {string} raw
 */
export function parseStashes(raw) {
  const stashes = []
  for (const line of String(raw ?? '').split('\n')) {
    if (line.trim() === '') continue
    const [ref, ...rest] = line.split('\0')
    const match = /^stash@\{(\d+)\}$/.exec((ref ?? '').trim())
    if (!match) continue
    stashes.push({ index: Number(match[1]), message: rest.join('\0').trim() })
  }
  return stashes
}

/**
 * Parse the graph log and compute lane geometry.
 *
 * Rather than drawing the ASCII `git log --graph` prefix, the host simulates
 * fixed lane slots and emits segments the client renders as SVG. A slot keeps a
 * stable column and colour until its expected commit is reached, so vertical
 * lines stay continuous and a branch does not change colour mid-history.
 *
 * @param {string} raw
 * @returns {Array<object>}
 */
export function parseGraph(raw) {
  const commits = []
  for (const line of String(raw ?? '').split('\n')) {
    if (line === '') continue
    const fields = line.split('\x1f')
    if (fields.length < 7) continue
    const [full, parents, short, author, date, decorations, ...subject] = fields
    if (!/^[0-9a-f]{40}$/.test(full)) continue
    commits.push({
      full,
      short: short || full.slice(0, 7),
      parents: parents ? parents.split(' ').filter(Boolean) : [],
      author: author || '',
      date: date || '',
      refs: decorations
        ? decorations
          .split(',')
          .map((ref) => ref.trim())
          .filter((ref) => ref !== '' && !/^[^/\s]+\/HEAD(?:\s|$)/.test(ref))
        : [],
      subject: subject.join('\x1f'),
    })
  }
  return decorateGraph(commits)
}

/**
 * Assign each commit row its node lane and inter-row edges.
 * @param {Array<object>} commits
 */
export function decorateGraph(commits) {
  /** @type {Array<{hash: string, color: number}|null>} */
  let slots = []
  const rows = []
  for (const commit of commits) {
    let node = slots.findIndex((slot) => slot !== null && slot.hash === commit.full)
    const nodeFromAbove = node !== -1
    if (node === -1) {
      node = slots.indexOf(null)
      if (node === -1) {
        node = slots.length
        slots.push(null)
      }
      slots[node] = { hash: commit.full, color: pickLaneColor(slots) }
    }
    const nodeColor = slots[node] ? slots[node].color : 0
    const trails = []
    const joins = []
    // Duplicate expectations of the same commit converge into the node lane.
    for (let lane = 0; lane < slots.length; lane += 1) {
      const slot = slots[lane]
      if (!slot) continue
      if (lane === node) continue
      if (slot.hash === commit.full) {
        joins.push({ from: lane, to: node, color: slot.color, kind: 'converge' })
        slots[lane] = null
      } else {
        trails.push({ from: lane, to: lane, color: slot.color })
      }
    }
    const parents = commit.parents ?? []
    if (parents.length === 0) {
      slots[node] = null
    } else {
      for (let parentIndex = 0; parentIndex < parents.length; parentIndex += 1) {
        const parent = parents[parentIndex]
        const existing = slots.findIndex((slot, lane) => lane !== node && slot !== null && slot.hash === parent)
        if (existing !== -1) {
          if (parentIndex === 0) slots[node] = null
          joins.push({
            from: node,
            to: existing,
            color: parentIndex === 0 ? nodeColor : (slots[existing]?.color ?? nodeColor),
            kind: parentIndex === 0 ? 'parent' : 'branch',
          })
          continue
        }
        if (parentIndex === 0) {
          slots[node] = { hash: parent, color: nodeColor }
        } else {
          let lane = findLane(slots, node)
          if (lane === -1) {
            lane = slots.length
            slots.push(null)
          }
          const color = pickLaneColor(slots)
          slots[lane] = { hash: parent, color }
          joins.push({ from: node, to: lane, color, kind: 'branch' })
        }
      }
    }
    let width = node + 1
    for (const trail of trails) width = Math.max(width, trail.from + 1)
    for (const join of joins) width = Math.max(width, join.from + 1, join.to + 1)
    for (let lane = 0; lane < slots.length; lane += 1) if (slots[lane]) width = Math.max(width, lane + 1)
    rows.push({
      full: commit.full,
      short: commit.short,
      author: commit.author,
      date: commit.date,
      refs: commit.refs,
      subject: commit.subject,
      lane: node,
      color: nodeColor,
      fromAbove: nodeFromAbove,
      width,
      trails,
      joins,
    })
    while (slots.length > 0 && slots[slots.length - 1] === null) slots.pop()
  }
  return rows
}

/** Pick a lane colour with the least current use, preferring low indices. */
function pickLaneColor(slots) {
  const counts = new Array(GRAPH_COLORS).fill(0)
  for (const slot of slots) if (slot) counts[slot.color] += 1
  let best = 0
  for (let color = 1; color < GRAPH_COLORS; color += 1) {
    if (counts[color] < counts[best]) best = color
  }
  return best
}

/** Find a free lane near `around`, preferring the right-hand side. */
function findLane(slots, around) {
  for (let offset = 1; offset <= slots.length + 1; offset += 1) {
    const right = around + offset
    if (right >= slots.length) break
    if (slots[right] === null) return right
    const left = around - offset
    if (left >= 0 && slots[left] === null) return left
  }
  return -1
}

/** Number of distinct lane colours exposed by the client theme. */
export const GRAPH_COLORS = 8

/**
 * Parse a unified diff (worktree, staged, commit or a two-blob conflict diff).
 *
 * Returns file sections so a multi-file commit can be rendered per file. Each
 * hunk gets word-level `inline` fragments for paired delete/add lines.
 *
 * @param {string} raw
 */
export function parseDiff(raw) {
  const text = String(raw ?? '')
  const files = []
  let file = null
  let hunk = null
  let oldLine = 0
  let newLine = 0

  const finishFile = () => {
    if (file === null) return
    if (file.path === '' && file.oldPath !== '') file.path = file.oldPath
    if (file.oldPath === file.path) file.oldPath = ''
    for (const item of file.hunks) item.lines = addInlineFragments(item.lines)
    files.push(file)
    file = null
    hunk = null
  }

  const lines = text.split('\n')
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  for (const line of lines) {
    if (line.startsWith('diff --git ')) {
      finishFile()
      const paths = splitDiffHeader(line)
      file = {
        path: paths.newPath,
        oldPath: paths.oldPath,
        status: 'M',
        binary: false,
        additions: 0,
        deletions: 0,
        hunks: [],
        meta: [],
      }
      continue
    }
    if (!file) continue
    if (line.startsWith('new file mode ')) {
      file.status = 'A'
      continue
    }
    if (line.startsWith('deleted file mode ')) {
      file.status = 'D'
      continue
    }
    if (line.startsWith('rename from ')) {
      file.oldPath = unquoteGitPath(line.slice('rename from '.length))
      file.status = 'R'
      continue
    }
    if (line.startsWith('rename to ')) {
      file.path = unquoteGitPath(line.slice('rename to '.length))
      file.status = 'R'
      continue
    }
    if (line.startsWith('--- ')) {
      const oldPath = normalizeDiffPath(line.slice(4))
      if (oldPath === null) {
        file.status = 'A'
        file.oldPath = ''
      } else {
        file.oldPath = oldPath
      }
      continue
    }
    if (line.startsWith('+++ ')) {
      const newPath = normalizeDiffPath(line.slice(4))
      if (newPath === null) {
        file.status = 'D'
        file.path = ''
      } else {
        file.path = newPath
      }
      continue
    }
    const binaryMatch = /^Binary files (.+) and (.+) differ$/.exec(line)
    if (binaryMatch) {
      file.binary = true
      if (!file.oldPath) file.oldPath = normalizeDiffPath(binaryMatch[1]) ?? ''
      if (!file.path) file.path = normalizeDiffPath(binaryMatch[2]) ?? ''
      continue
    }
    if (line === 'GIT binary patch') {
      file.binary = true
      continue
    }
    const header = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/.exec(line)
    if (header) {
      oldLine = Number(header[1])
      newLine = Number(header[3])
      hunk = { header: line, lines: [] }
      file.hunks.push(hunk)
      continue
    }
    if (!hunk) continue
    if (line === '') {
      hunk.lines.push({ kind: 'ctx', text: '', old: oldLine, new: newLine })
      oldLine += 1
      newLine += 1
      continue
    }
    const marker = line[0]
    if (marker === '+') {
      hunk.lines.push({ kind: 'add', text: line.slice(1), new: newLine })
      file.additions += 1
      newLine += 1
    } else if (marker === '-') {
      hunk.lines.push({ kind: 'del', text: line.slice(1), old: oldLine })
      file.deletions += 1
      oldLine += 1
    } else if (marker === ' ') {
      hunk.lines.push({ kind: 'ctx', text: line.slice(1), old: oldLine, new: newLine })
      oldLine += 1
      newLine += 1
    } else if (marker === '\\') {
      hunk.lines.push({ kind: 'meta', text: line })
    }
  }
  finishFile()
  return {
    files,
    additions: files.reduce((sum, item) => sum + item.additions, 0),
    deletions: files.reduce((sum, item) => sum + item.deletions, 0),
    binary: files.some((item) => item.binary),
  }
}

/** Split `diff --git a/x b/y` without breaking paths that contain spaces. */
function splitDiffHeader(line) {
  const rest = line.slice('diff --git '.length)
  const separator = rest.lastIndexOf(' b/')
  if (separator < 0) return { oldPath: '', newPath: '' }
  return {
    oldPath: unquoteGitPath(rest.slice(2, separator)),
    newPath: unquoteGitPath(rest.slice(separator + 3)),
  }
}

/** Normalize a `---`/`+++`/binary path into a repository-relative path. */
function normalizeDiffPath(value) {
  let path = String(value ?? '').trim()
  if (path === '/dev/null') return null
  const tab = path.indexOf('\t')
  if (tab !== -1) path = path.slice(0, tab)
  path = unquoteGitPath(path)
  if (path.startsWith('a/') || path.startsWith('b/')) path = path.slice(2)
  return path
}

/** Decode a git-quoted path (C-style escapes) when present. */
export function unquoteGitPath(value) {
  let path = String(value ?? '').trim()
  if (path.length >= 2 && path.startsWith('"') && path.endsWith('"')) {
    const body = path.slice(1, -1)
    let output = ''
    for (let index = 0; index < body.length; index += 1) {
      const char = body[index]
      if (char !== '\\') {
        output += char
        continue
      }
      const next = body[index + 1]
      index += 1
      if (next === undefined) break
      if (next === 't') output += '\t'
      else if (next === 'n') output += '\n'
      else if (next === 'r') output += '\r'
      else if (next === '"' || next === '\\') output += next
      else if (/[0-7]/.test(next)) {
        const octal = body.slice(index, index + 3)
        const code = Number.parseInt(octal, 8)
        if (Number.isFinite(code)) {
          output += String.fromCharCode(code)
          index += 2
        }
      } else output += next
    }
    return output
  }
  // Unquoted paths in `---`/`+++` may carry a trailing timestamp after a tab.
  const tab = path.indexOf('\t')
  return tab === -1 ? path : path.slice(0, tab)
}

/**
 * Add `inline` fragments to adjacent delete/add blocks in a hunk.
 * @param {Array<{kind: string, text: string}>} lines
 */
export function addInlineFragments(lines) {
  const output = lines.map((line) => ({ ...line }))
  let index = 0
  while (index < output.length) {
    if (output[index].kind !== 'del') {
      index += 1
      continue
    }
    let delEnd = index
    while (delEnd < output.length && output[delEnd].kind === 'del') delEnd += 1
    let addEnd = delEnd
    while (addEnd < output.length && output[addEnd].kind === 'add') addEnd += 1
    const paired = Math.min(delEnd - index, addEnd - delEnd)
    for (let offset = 0; offset < paired; offset += 1) {
      const parts = diffWords(output[index + offset].text, output[delEnd + offset].text)
      const before = parts.before
      const after = parts.after
      const interesting = before.length > 1 || after.length > 1
      if (interesting) {
        output[index + offset].inline = before
        output[delEnd + offset].inline = after
      }
    }
    index = addEnd
  }
  return output
}

/** Token limit above which word-level comparison degrades to whole-line marking. */
const INLINE_TOKEN_LIMIT = 420

/**
 * Compute word-level changed fragments for one deleted line and one added line.
 * @param {string} before
 * @param {string} after
 * @returns {{before: Array<{text: string, changed: boolean}>, after: Array<{text: string, changed: boolean}>}}
 */
export function diffWords(before, after) {
  const left = tokenize(String(before ?? ''))
  const right = tokenize(String(after ?? ''))
  if (left.length === 0 || right.length === 0 || left.length + right.length > INLINE_TOKEN_LIMIT) {
    return {
      before: [{ text: left.join(''), changed: left.length > 0 }],
      after: [{ text: right.join(''), changed: right.length > 0 }],
    }
  }
  const matches = lcs(left, right)
  return {
    before: mergeTokens(left, matches.left),
    after: mergeTokens(right, matches.right),
  }
}

function tokenClass(char) {
  const code = char.codePointAt(0) ?? 0
  if (/\s/.test(char)) return 'space'
  if (isWideCharacter(code)) return 'wide'
  if (/[A-Za-z0-9_$]/.test(char)) return 'word'
  return 'punct'
}

function isWideCharacter(code) {
  return (
    (code >= 0x3040 && code <= 0x30ff) ||
    (code >= 0x3400 && code <= 0x4dbf) ||
    (code >= 0x4e00 && code <= 0x9fff) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xff00 && code <= 0xffef) ||
    (code >= 0xac00 && code <= 0xd7af)
  )
}

function tokenize(text) {
  const tokens = []
  let buffer = ''
  let kind = ''
  for (const char of text) {
    const next = tokenClass(char)
    if (next === 'wide') {
      if (buffer !== '') tokens.push(buffer)
      buffer = ''
      kind = ''
      tokens.push(char)
      continue
    }
    if (next === kind) {
      buffer += char
      continue
    }
    if (buffer !== '') tokens.push(buffer)
    buffer = char
    kind = next
  }
  if (buffer !== '') tokens.push(buffer)
  return tokens
}

/** Longest common subsequence over two token arrays. */
function lcs(left, right) {
  const n = left.length
  const m = right.length
  const table = []
  for (let row = 0; row <= n; row += 1) table.push(new Uint16Array(m + 1))
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      table[i][j] = left[i] === right[j]
        ? table[i + 1][j + 1] + 1
        : Math.max(table[i + 1][j], table[i][j + 1])
    }
  }
  const leftMatched = new Set()
  const rightMatched = new Set()
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (left[i] === right[j]) {
      leftMatched.add(i)
      rightMatched.add(j)
      i += 1
      j += 1
    } else if (table[i + 1][j] >= table[i][j + 1]) i += 1
    else j += 1
  }
  return { left: leftMatched, right: rightMatched }
}

function mergeTokens(tokens, matched) {
  const output = []
  for (let index = 0; index < tokens.length; index += 1) {
    const changed = !matched.has(index)
    const previous = output[output.length - 1]
    if (previous && previous.changed === changed) previous.text += tokens[index]
    else output.push({ text: tokens[index], changed })
  }
  return output
}

/**
 * Parse `git show -s --format=...` commit metadata.
 * @param {string} raw
 */
export function parseCommitInfo(raw) {
  const fields = String(raw ?? '').split('\x1f')
  if (fields.length < 9) return null
  const [full, short, author, email, timestamp, relative, decorations, parents, ...message] = fields
  const body = message.join('\x1f')
  const lines = body.split('\n')
  const subject = (lines[0] ?? '').trim()
  const rest = lines.slice(1).join('\n').replace(/^\n+/, '').replace(/\s+$/, '')
  return {
    full,
    short,
    author,
    email,
    timestamp: Number(timestamp) * 1000,
    relative,
    refs: decorations ? decorations.split(',').map((ref) => ref.trim()).filter(Boolean) : [],
    parents: parents ? parents.split(' ').filter(Boolean) : [],
    subject,
    body: rest,
  }
}

/** Run-of-the-mill relative-time formatter used for "last fetched" labels. */
export function relativeTime(milliseconds) {
  const elapsed = Math.max(0, Date.now() - Number(milliseconds || 0))
  const seconds = Math.round(elapsed / 1000)
  if (seconds < 45) return { unit: 'second', value: Math.max(1, seconds) }
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return { unit: 'minute', value: minutes }
  const hours = Math.round(minutes / 60)
  if (hours < 24) return { unit: 'hour', value: hours }
  const days = Math.round(hours / 24)
  return { unit: 'day', value: days }
}