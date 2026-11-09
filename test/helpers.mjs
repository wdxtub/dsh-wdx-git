import { spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { cleanGitEnv } from '../src/git.js'

/**
 * Minimal exec implementation for tests: run git and collect all output.
 * @param {string[]} argv
 * @param {{cwd: string, timeoutMs?: number, signal?: AbortSignal}} options
 */
export function exec(argv, options) {
  const { cwd, timeoutMs = 30000, signal } = options
  return new Promise((resolve, reject) => {
    const child = spawn(argv[0], argv.slice(1), {
      cwd,
      env: cleanGitEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
      signal,
    })
    const stdout = []
    const stderr = []
    child.stdout.on('data', (chunk) => stdout.push(chunk))
    child.stderr.on('data', (chunk) => stderr.push(chunk))
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs)
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({
        code,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      })
    })
  })
}

/** Run git and throw on failure, returning trimmed stdout. */
export async function git(args, cwd) {
  const result = await exec(['git', ...args], { cwd })
  if (result.code !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr || result.stdout}`)
  }
  return result.stdout.trim()
}

export async function tempDir(prefix = 'wdx-git-') {
  return mkdtemp(join(tmpdir(), prefix))
}

/** Create a repo with one commit and a bare remote it tracks. */
export async function createRepo() {
  const base = await tempDir()
  const repo = join(base, 'repo')
  const remote = join(base, 'remote.git')
  await mkdir(repo)
  await mkdir(remote)
  await git(['init', '--bare', '-q', '-b', 'main'], remote)
  await git(['init', '-q', '-b', 'main'], repo)
  await git(['config', 'user.email', 'test@example.com'], repo)
  await git(['config', 'user.name', 'Test User'], repo)
  await writeFile(join(repo, 'README.md'), '# repo\n')
  await git(['add', '-A'], repo)
  await git(['commit', '-q', '-m', 'chore: initial commit'], repo)
  await git(['remote', 'add', 'origin', remote], repo)
  await git(['push', '-q', '-u', 'origin', 'main'], repo)
  return { base, repo, remote }
}

/** Create a second clone of the same bare remote. */
export async function cloneRepo(base, name = 'clone') {
  const path = join(base, name)
  await git(['clone', '-q', join(base, 'remote.git'), path], base)
  await git(['config', 'user.email', 'clone@example.com'], path)
  await git(['config', 'user.name', 'Clone User'], path)
  return path
}

/** Write a file inside a repository. */
export async function write(repo, path, content) {
  await mkdir(join(repo, path.split('/').slice(0, -1).join('/') || '.'), { recursive: true })
  await writeFile(join(repo, path), content)
}

export async function cleanup(path) {
  await rm(path, { recursive: true, force: true })
}

/** Fake llm service that streams a fixed message. */
export function fakeLlm(text, { finish = 'stop' } = {}) {
  return {
    listProviders: () => [{ id: 'fake', name: 'Fake' }],
    listModels: async () => [{ id: 'cheap', name: 'Cheap', provider: 'fake' }],
    resolveModelInfo: async () => ({
      provider: 'fake', id: 'cheap', name: 'Cheap',
      reasoning: { efforts: [{ id: 'low', name: 'Low' }, { id: 'none', name: 'Off' }] },
    }),
    stream: (options) => ({
      async *[Symbol.asyncIterator]() {
        options.signal?.throwIfAborted()
        yield { type: 'text-delta', text }
        yield { type: 'finish', reason: { kind: finish } }
      },
    }),
  }
}

/** Session store stub whose live session reports a request-header model. */
export function fakeSessions(selection) {
  return {
    get: (id) => (id === 'session-1'
      ? { requestHeader: () => ({ config: selection }) }
      : undefined),
  }
}