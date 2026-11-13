import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

const httpError = status => Object.assign(new Error('Request failed'), { response: { status } })

const fixture = ({ verify = async () => ({ valid: true, username: 'operator' }), refresh } = {}) => {
  const calls = { verify: 0, refresh: 0, clear: 0 }
  let accessToken = 'fixture-access'
  let refreshToken = 'fixture-refresh'
  const service = {
    getAuthStatus: async () => ({ enabled: true, has_users: true }),
    getAccessToken: () => accessToken,
    getRefreshToken: () => refreshToken,
    isAuthenticated: () => !!accessToken,
    verifyToken: async token => {
      // Bound even a broken implementation so this regression cannot hang CI.
      assert.ok(++calls.verify <= 3, 'verification must settle without recursion')
      return verify(token, calls.verify)
    },
    refreshToken: async () => {
      assert.ok(++calls.refresh <= 2, 'refresh must settle without recursion')
      if (refresh) await refresh()
      accessToken = 'fixture-rotated-access'
      refreshToken = 'fixture-rotated-refresh'
    },
    clearTokens: () => { calls.clear++; accessToken = null; refreshToken = null },
  }
  const source = fs.readFileSync(new URL('../stores/auth.js', import.meta.url), 'utf8')
    .replace(/^import .*$/gm, '')
    .replace('export const useAuthStore = ', 'globalThis.useAuthStore = ')
  const context = {
    authRepository: () => service,
    defineStore: (_name, factory) => factory,
    ref: value => ({ value }),
    computed: read => ({ get value() { return read() } }),
    console: { warn() {}, error() {} },
  }
  vm.runInNewContext(source, context, { filename: 'stores/auth.js' })
  return { store: context.useAuthStore(), calls, token: () => accessToken }
}

test('a recovery hold settles auth initialization without refresh or losing tokens', async () => {
  const { store, calls, token } = fixture({ verify: async () => { throw httpError(409) } })
  await store.initialize()
  assert.equal(store._initialized.value, true)
  assert.equal(store.loading.value, false)
  assert.equal(store.isAuthEnabled.value, true)
  assert.equal(store.authSupported.value, true)
  assert.equal(store.isAuthenticated.value, false)
  assert.match(store.error.value, /HTTP 409.*recovery hold/)
  assert.deepEqual(calls, { verify: 1, refresh: 0, clear: 0 })
  assert.equal(token(), 'fixture-access')
})

test('a backend error or network outage preserves credentials without refreshing', async () => {
  for (const status of [403, 500, 503, undefined]) {
    const { store, calls, token } = fixture({ verify: async () => { throw httpError(status) } })
    assert.equal(await store.verifyCurrentToken(), false)
    assert.match(store.error.value, /Unable to verify your session/)
    assert.deepEqual(calls, { verify: 1, refresh: 0, clear: 0 })
    assert.equal(token(), 'fixture-access')
  }
})

test('an expired access token refreshes once and verifies the rotated token', async () => {
  const { store, calls } = fixture({ verify: async (token, count) => {
    if (count === 1) throw httpError(401)
    assert.equal(token, 'fixture-rotated-access')
    return { valid: true, username: 'operator' }
  } })
  assert.equal(await store.verifyCurrentToken(), true)
  assert.equal(store.user.value.username, 'operator')
  assert.equal(store.error.value, null)
  assert.deepEqual(calls, { verify: 2, refresh: 1, clear: 0 })
})

test('a repeatedly invalid rotated token ends the session after one refresh', async () => {
  for (const verify of [async () => ({ valid: false }), async () => { throw httpError(401) }]) {
    const { store, calls, token } = fixture({ verify })
    assert.equal(await store.verifyCurrentToken(), false)
    assert.deepEqual(calls, { verify: 2, refresh: 1, clear: 1 })
    assert.equal(token(), null)
    assert.equal(store.user.value, null)
    assert.match(store.error.value, /session has expired/)
  }
})

test('a hold after a successful refresh preserves the newly rotated credentials', async () => {
  const { store, calls, token } = fixture({ verify: async (_token, count) => {
    if (count === 1) return { valid: false }
    throw httpError(409)
  } })
  assert.equal(await store.verifyCurrentToken(), false)
  assert.deepEqual(calls, { verify: 2, refresh: 1, clear: 0 })
  assert.equal(token(), 'fixture-rotated-access')
  assert.match(store.error.value, /HTTP 409/)
})

test('refresh failures clear only rejected credentials and remain bounded', async () => {
  for (const status of [401, 403, 409, 503, undefined]) {
    const { store, calls, token } = fixture({
      verify: async () => ({ valid: false }),
      refresh: async () => { throw httpError(status) },
    })
    assert.equal(await store.verifyCurrentToken(), false)
    const rejected = status === 401 || status === 403
    assert.deepEqual(calls, { verify: 1, refresh: 1, clear: rejected ? 1 : 0 })
    assert.equal(token(), rejected ? null : 'fixture-access')
  }
})

test('successful retry clears the temporary auth error', async () => {
  let blocked = true
  const { store, calls } = fixture({ verify: async () => {
    if (blocked) throw httpError(409)
    return { valid: true, username: 'operator' }
  } })
  await store.initialize()
  blocked = false
  assert.equal(await store.verifyCurrentToken(), true)
  assert.equal(store.error.value, null)
  assert.equal(store.isAuthenticated.value, true)
  assert.deepEqual(calls, { verify: 2, refresh: 0, clear: 0 })
})
