/**
 * dsh-wdx-git — Host entry.
 *
 * Registers an authenticated POST route consumed by the right-sidebar panel.
 * Git runs through `ctx.subprocess` with a sanitized environment; AI calls use
 * the optional `llm`, `sessions` and `agentDefaultModel` services.
 */
import { cleanGitEnv, GitError, proxyEnvFromScutil } from './src/git.js'
import { createOperations } from './src/operations.js'

export const name = 'wdx-git'
export const inject = ['connection', 'subprocess']

const ROUTE_PATH = '/api/wdx-git'
const STDOUT_MAX_BYTES = 16 * 1024 * 1024
const STDERR_MAX_BYTES = 2 * 1024 * 1024

function json(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
}

function errorPayload(error) {
  const code = error instanceof GitError ? error.code : 'internal'
  const raw = error && error.message ? String(error.message) : String(error)
  return {
    ok: false,
    error: {
      code,
      message: raw.length > 6000 ? `${raw.slice(0, 6000)}…` : raw,
      ...(error instanceof GitError && error.data !== undefined ? { data: error.data } : {}),
    },
  }
}

function readCollected(handle, stream) {
  try {
    const reader = handle?.collected?.[stream]
    if (!reader) return ''
    return reader.readFrom(0).text ?? ''
  } catch {
    return ''
  }
}

let proxyCache = { at: 0, env: {} }
const PROXY_TTL_MS = 60_000

function hasExplicitProxy(source = process.env) {
  return Boolean(
    source.HTTPS_PROXY || source.https_proxy || source.HTTP_PROXY || source.http_proxy
    || source.ALL_PROXY || source.all_proxy,
  )
}

/**
 * Read the macOS system proxy. The desktop app is launched from Finder, so it
 * does not inherit the shell's proxy env; without this, curl tries a direct
 * connection while GitHub Desktop (which uses the system proxy) works fine.
 */
async function resolveProxyEnv(ctx) {
  if (process.platform !== 'darwin' || hasExplicitProxy()) return {}
  if (Date.now() - proxyCache.at < PROXY_TTL_MS) return proxyCache.env
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 1800)
  try {
    const handle = ctx.subprocess.spawn({
      argv: ['/usr/sbin/scutil', '--proxy'],
      cwd: process.env.HOME || '/',
      stdio: {
        stdin: 'ignore',
        stdout: { maxBytes: 64 * 1024 },
        stderr: { maxBytes: 8 * 1024 },
      },
      graceMs: 1000,
      signal: controller.signal,
    })
    const outcome = await handle.done
    const text = outcome.exitCode === 0 ? readCollected(handle, 'stdout') : ''
    const env = text ? proxyEnvFromScutil(text) : {}
    proxyCache = { at: Date.now(), env }
    return env
  } catch {
    proxyCache = { at: Date.now(), env: {} }
    return {}
  } finally {
    clearTimeout(timer)
  }
}

/** Wrap `ctx.subprocess.spawn` into the simple exec contract operations expects. */
function createExec(ctx) {
  return async function exec(argv, options = {}) {
    const { cwd, signal, timeoutMs = 30000 } = options
    const proxyEnv = await resolveProxyEnv(ctx)
    const controller = new AbortController()
    let timedOut = false
    const forwardAbort = () => controller.abort()
    if (signal) {
      if (signal.aborted) controller.abort()
      else signal.addEventListener('abort', forwardAbort, { once: true })
    }
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, Math.max(100, timeoutMs))
    try {
      const handle = ctx.subprocess.spawn({
        argv,
        cwd,
        stdio: {
          stdin: 'ignore',
          stdout: { maxBytes: STDOUT_MAX_BYTES },
          stderr: { maxBytes: STDERR_MAX_BYTES },
        },
        graceMs: 3000,
        signal: controller.signal,
        env: Object.assign(cleanGitEnv(), proxyEnv),
      })
      const outcome = await handle.done
      const stdout = readCollected(handle, 'stdout')
      const stderr = readCollected(handle, 'stderr')
      if (timedOut || controller.signal.aborted) {
        throw new GitError(`git 命令超时或被取消：${argv.join(' ')}`, {
          code: 'timeout', stdout, stderr,
        })
      }
      return { code: outcome.exitCode, stdout, stderr }
    } catch (error) {
      if (error instanceof GitError) throw error
      if (timedOut || controller.signal.aborted) {
        throw new GitError(`git 命令超时或被取消：${argv.join(' ')}`, { code: 'timeout' })
      }
      const message = error && error.message ? error.message : String(error)
      const missingCwd = error?.code === 'ENOENT' || /\bENOENT\b/.test(message)
      throw new GitError(
        missingCwd
          ? `无法访问工作目录或 git 可执行文件（${cwd}）：${message}`
          : `无法执行 ${argv.join(' ')}：${message}`,
        { code: missingCwd ? 'cwd-unavailable' : 'internal' },
      )
    } finally {
      clearTimeout(timer)
      if (signal) signal.removeEventListener('abort', forwardAbort)
    }
  }
}

function readDefaultSelection(ctx) {
  try {
    return ctx.get('agentDefaultModel')?.currentSelection?.() ?? null
  } catch {
    return null
  }
}

async function handleRequest(request, operations) {
  if (request.method !== 'POST') {
    return json(405, { ok: false, error: { code: 'invalid-params', message: '只支持 POST' } })
  }
  let body
  try {
    body = await request.json()
  } catch {
    return json(400, { ok: false, error: { code: 'invalid-params', message: '请求体不是合法 JSON' } })
  }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return json(400, { ok: false, error: { code: 'invalid-params', message: '请求体必须是 JSON 对象' } })
  }
  const { op, ...params } = body
  try {
    const data = await operations.handle(op, params, request.signal)
    return json(200, { ok: true, data })
  } catch (error) {
    const status = error instanceof GitError && error.code === 'invalid-params' ? 400 : 200
    return json(status, errorPayload(error))
  }
}

export function apply(ctx) {
  const operations = createOperations({
    exec: createExec(ctx),
    services: () => ({
      llm: ctx.get('llm'),
      sessions: ctx.get('sessions'),
      defaultModel: {
        currentSelection: () => readDefaultSelection(ctx),
      },
    }),
  })
  ctx.effect(() => {
    const dispose = ctx.connection.fetch.register({
      path: ROUTE_PATH,
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: (request) => handleRequest(request, operations),
    })
    return () => {
      void dispose()
    }
  }, 'wdx-git: POST route')
  ctx.logger?.info?.(`[wdx-git] registered ${ROUTE_PATH}`)
}