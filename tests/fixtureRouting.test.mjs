import assert from 'node:assert/strict'
import test from 'node:test'
import { realAppProxyRoute, realAppParentHtml, embeddedParentHtml, fixtureRequestPath } from './support/fixtureRouting.mjs'

test('real-app fixture dispatch only accepts registered literal services and preserves request objects', () => {
  const seen = []
  const proxy = (req, res) => seen.push({ req, res })
  const proxies = new Map([['infinidysk', proxy], ['seerr', proxy], ['__proto__', proxy], ['constructor', proxy]])
  for (const service of ['infinidysk', 'seerr']) {
    const route = realAppProxyRoute(proxies, '/service/ui/' + service + '/api?key=a%2Fb')
    assert.equal(route.path, '/api?key=a%2Fb')
    const req = { method: 'POST', headers: { authorization: 'fixture-only' }, body: 'unchanged' }, res = {}
    route.proxy(req, res)
    assert.equal(seen.at(-1).req, req); assert.equal(seen.at(-1).res, res)
  }
  for (const service of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'unknown']) assert.equal(realAppProxyRoute(proxies, '/service/ui/' + service + '/api'), null)
})

test('fixture iframe pages are static and unknown or markup-bearing identities are rejected', () => {
  for (const service of ['infinidysk', 'seerr']) assert.equal(realAppParentHtml('/parent/' + service), '<iframe src="/ui/' + service + '/"></iframe>')
  for (const service of ['radarr', 'decypharr', 'radarr_second']) assert.ok(embeddedParentHtml('/services/' + service).includes('src="/ui/' + service + '/"'))
  for (const service of ['__proto__', 'constructor', 'unknown', 'radarr"onload="example', 'radarr%22']) {
    assert.equal(realAppParentHtml('/parent/' + service), null)
    assert.equal(embeddedParentHtml('/services/' + service), null)
  }
})

test('fixed-origin fixture forwarding preserves origin-form paths and rejects destination overrides', () => {
  for (const path of ['/api/health', '/ui/radarr/sw.js?x=a%2Fb&name=a%20b', '/literal%2Ffile']) assert.equal(fixtureRequestPath(path), path)
  for (const path of ['http://reserved.example/probe', 'https://reserved.example/probe', '//reserved.example/probe', 'relative', '', null]) assert.equal(fixtureRequestPath(path), null)
  for (const code of [...Array(33).keys(), 92, 127]) assert.equal(fixtureRequestPath('/' + String.fromCharCode(code) + '/reserved.example'), null)
})
