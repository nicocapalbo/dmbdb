import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

const middleware = (name, { auth = {}, onboarding = {} } = {}) => {
  const redirects = []
  const authStore = {
    _initialized: true, loading: false, authSupported: true, hasUsers: true,
    setupSkipped: false, oidcLoginEnabled: false, isAuthEnabled: true,
    isAuthenticated: true, ...auth,
  }
  const onboardingStore = { needsOnboarding: true, check: async () => {}, ...onboarding }
  const source = fs.readFileSync(new URL(`../middleware/${name}.global.js`, import.meta.url), 'utf8')
    .replace(/^import .*$/gm, '')
    .replace('export default ', 'globalThis.middleware = ')
  const context = {
    process: { server: false }, console: { debug() {}, warn() {} },
    defineNuxtRouteMiddleware: value => value,
    navigateTo: destination => { redirects.push(destination); return destination },
    useAuthStore: () => authStore,
    useOnboardingStore: () => onboardingStore,
  }
  vm.runInNewContext(source, context, { filename: `${name}.global.js` })
  return { run: context.middleware, redirects, onboardingStore }
}

test('installation recovery opens Settings before onboarding without completing or starting it', async () => {
  let checks = 0
  const fixture = middleware('onboarding', { onboarding: { check: async () => { checks++ } } })
  await fixture.run({ path: '/settings', hash: '#backups', fullPath: '/settings#backups' })
  assert.deepEqual(fixture.redirects, [])
  assert.equal(checks, 0)
  assert.equal(fixture.onboardingStore.needsOnboarding, true)
})

test('the recovery exception is limited to its exact Settings anchor', async () => {
  for (const route of [
    { path: '/settings', hash: '' },
    { path: '/settings', hash: '#about' },
    { path: '/services', hash: '#backups' },
  ]) {
    const fixture = middleware('onboarding')
    await fixture.run(route)
    assert.deepEqual(fixture.redirects, ['/onboarding'])
    assert.equal(fixture.onboardingStore.needsOnboarding, true)
  }
})

test('fresh installation recovery still requires initial authentication setup', async () => {
  const fixture = middleware('auth', { auth: { hasUsers: false, isAuthenticated: false } })
  await fixture.run({ path: '/settings', hash: '#backups', fullPath: '/settings#backups' })
  assert.deepEqual(fixture.redirects, ['/setup'])
})

test('an unauthenticated recovery request returns through normal login', async () => {
  const fixture = middleware('auth', { auth: { isAuthenticated: false } })
  await fixture.run({ path: '/settings', hash: '#backups', fullPath: '/settings#backups' })
  assert.equal(fixture.redirects[0].path, '/login')
  assert.equal(fixture.redirects[0].query.redirect, '/settings#backups')
})
