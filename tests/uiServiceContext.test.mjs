import assert from 'node:assert/strict'
import test from 'node:test'

import {
  clearUiServiceContextCookie,
  shouldClearUiServiceContext,
} from '../helper/uiServiceContext.js'

test('clears embedded UI context when returning to DUMB routes', () => {
  const from = { params: { serviceId: 'InfiniDysk' }, path: '/services/InfiniDysk' }

  for (const path of ['/', '/metrics', '/settings', '/services']) {
    assert.equal(
      shouldClearUiServiceContext({ params: {}, path }, from),
      true,
      path,
    )
  }
})

test('clears context between services but preserves same-service tab changes', () => {
  const current = { params: { serviceId: 'InfiniDysk' }, path: '/services/InfiniDysk' }

  assert.equal(
    shouldClearUiServiceContext(
      { params: { serviceId: 'InfiniDysk' }, path: '/services/InfiniDysk', query: { tab: 'logs' } },
      current,
    ),
    false,
  )
  assert.equal(
    shouldClearUiServiceContext(
      { params: { serviceId: 'Traefik' }, path: '/services/Traefik' },
      current,
    ),
    true,
  )
})

test('clears stale context on initial non-service and service loads', () => {
  assert.equal(shouldClearUiServiceContext({ params: {}, path: '/' }), true)
  assert.equal(
    shouldClearUiServiceContext({
      params: { serviceId: 'InfiniDysk' },
      path: '/services/InfiniDysk',
    }),
    true,
  )
})

test('expires the shared embedded-service cookie at the root path', () => {
  const previousDocument = globalThis.document
  globalThis.document = { cookie: '' }

  try {
    clearUiServiceContextCookie()
    assert.equal(
      globalThis.document.cookie,
      'dumb_ui_service=; path=/; Max-Age=0; SameSite=Lax',
    )
  } finally {
    if (previousDocument === undefined) {
      delete globalThis.document
    } else {
      globalThis.document = previousDocument
    }
  }
})
