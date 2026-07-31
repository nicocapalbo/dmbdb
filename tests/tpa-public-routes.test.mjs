import assert from 'node:assert/strict'
import test from 'node:test'

import { isTpaServiceKey, selectTpaPublicRoute } from '../helper/tpaPublicRoutes.js'

test('recognizes normalized and underscored Traefik Proxy Admin service keys', () => {
  assert.equal(isTpaServiceKey('traefik_proxy_admin'), true)
  assert.equal(isTpaServiceKey('traefikproxyadmin'), true)
  assert.equal(isTpaServiceKey('Traefik Proxy Admin'), true)
  assert.equal(isTpaServiceKey('traefik'), false)
})

test('selects an enabled loopback TPA route with the service port', () => {
  const selected = selectTpaPublicRoute([
    {
      name: 'Example Service',
      enabled: true,
      target_port: 8080,
      target_loopback: true,
      public_urls: ['https://service.example.com'],
    },
  ], {
    names: ['Example Service'],
    ports: [8080],
  })

  assert.equal(selected?.publicUrl, 'https://service.example.com')
})

test('requires a related service name for non-loopback TPA targets', () => {
  const routes = [{
    name: 'DUMB Frontend',
    enabled: true,
    target_port: 3005,
    target_loopback: false,
    public_urls: ['https://dumb.example.com'],
  }]

  assert.equal(selectTpaPublicRoute(routes, {
    names: ['DUMB Frontend'],
    ports: [3005],
  })?.publicUrl, 'https://dumb.example.com')
  assert.equal(selectTpaPublicRoute(routes, {
    names: ['Unrelated Service'],
    ports: [3005],
  }), null)
})

test('ignores disabled, wrong-port, and unsafe public routes', () => {
  const selected = selectTpaPublicRoute([
    {
      name: 'Disabled',
      enabled: false,
      target_port: 8080,
      target_loopback: true,
      public_urls: ['https://disabled.example.com'],
    },
    {
      name: 'Wrong Port',
      enabled: true,
      target_port: 9090,
      target_loopback: true,
      public_urls: ['https://wrong.example.com'],
    },
    {
      name: 'Unsafe',
      enabled: true,
      target_port: 8080,
      target_loopback: true,
      public_urls: ['http://unsafe.example.com'],
    },
  ], {
    names: ['Example Service'],
    ports: [8080],
  })

  assert.equal(selected, null)
})
