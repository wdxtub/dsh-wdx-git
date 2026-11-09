import assert from 'node:assert/strict'
import test from 'node:test'
import { proxyEnvFromScutil } from '../src/git.js'

const SAMPLE = `<dictionary> {
  ExceptionsList : <array> {
    0 : *zhihu.com
    1 : *zhimg.com
    2 : localhost
    3 : *.local
    4 : 127.*
    5 : 10.*
    6 : 172.16.*
    7 : 192.168.*
  }
  FTPPassive : 1
  HTTPEnable : 1
  HTTPPort : 7890
  HTTPProxy : 127.0.0.1
  HTTPSEnable : 1
  HTTPSPort : 7890
  HTTPSProxy : 127.0.0.1
  ProxyAutoConfigEnable : 0
  SOCKSEnable : 1
  SOCKSPort : 7890
  SOCKSProxy : 127.0.0.1
}`

test('proxyEnvFromScutil maps the system HTTP/HTTPS proxy for git', () => {
  const env = proxyEnvFromScutil(SAMPLE, {})
  assert.equal(env.HTTPS_PROXY, 'http://127.0.0.1:7890')
  assert.equal(env.https_proxy, env.HTTPS_PROXY)
  assert.equal(env.HTTP_PROXY, 'http://127.0.0.1:7890')
  assert.match(env.NO_PROXY, /localhost/)
  assert.match(env.NO_PROXY, /127\.0\.0\.1/)
  assert.match(env.NO_PROXY, /\.local/)
  assert.match(env.NO_PROXY, /zhihu\.com/)
  assert.match(env.NO_PROXY, /172\.16\.0\.0\/12/)
  assert.doesNotMatch(env.NO_PROXY, /\*/)
})

test('an explicit proxy in the parent environment wins over the system proxy', () => {
  const env = proxyEnvFromScutil(SAMPLE, { HTTPS_PROXY: 'http://corp:8080' })
  assert.deepEqual(env, {})
})

test('NO_PROXY=* disables system proxy injection', () => {
  assert.deepEqual(proxyEnvFromScutil(SAMPLE, { NO_PROXY: '*' }), {})
})

test('SOCKS is used only when no HTTP/HTTPS proxy is available', () => {
  const socks = `<dictionary> {
    HTTPEnable : 0
    HTTPSEnable : 0
    SOCKSEnable : 1
    SOCKSPort : 7890
    SOCKSProxy : 127.0.0.1
  }`
  const env = proxyEnvFromScutil(socks, {})
  assert.equal(env.ALL_PROXY, 'socks5://127.0.0.1:7890')
  assert.equal(env.HTTP_PROXY, undefined)
  assert.equal(env.HTTPS_PROXY, undefined)
})
