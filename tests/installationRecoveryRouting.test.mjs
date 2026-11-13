import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { setupInstallationHoldError } from '../helper/setupArrangements.js'

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
    setupInstallationHoldError,
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

test('an authored installation hold redirects ordinary landing routes to backup recovery', async () => {
  for (const detail of [
    'Installation recovery owns persistence; use its status and recovery controls.',
    'An installation backup, restore or recovery is controlling persistence. Use Backup and restore for status.',
  ]) {
    for (const path of ['/', '/settings', '/services']) {
      let checks = 0
      const fixture = middleware('onboarding', { onboarding: {
        needsOnboarding: null,
        check: async () => { checks++; throw { response: { status: 409, data: { detail } } } },
      } })
      await fixture.run({ path, hash: '', fullPath: path })
      assert.deepEqual(fixture.redirects, ['/settings#backups'])
      assert.equal(fixture.onboardingStore.needsOnboarding, null)
      await fixture.run({ path: '/settings', hash: '#backups', fullPath: '/settings#backups' })
      assert.equal(checks, 1)
      assert.equal(fixture.redirects.length, 1)
    }
  }
})

test('unrelated onboarding failures retain their error instead of redirecting or completing setup', async () => {
  for (const [status, detail] of [[401, 'Authentication required'], [403, 'Forbidden'],
    [409, 'A different conflict'], [503, 'Storage unavailable'], [undefined, undefined]]) {
    const error = Object.assign(new Error('Unavailable'), { response: { status, data: { detail } } })
    const fixture = middleware('onboarding', { onboarding: {
      needsOnboarding: null, check: async () => { throw error },
    } })
    await assert.rejects(fixture.run({ path: '/', hash: '' }), value => value === error)
    assert.deepEqual(fixture.redirects, [])
    assert.equal(fixture.onboardingStore.needsOnboarding, null)
  }
})
