import test from 'node:test'
import assert from 'node:assert/strict'
import { loadProxyHarness } from './support/proxyHarness.mjs'

test('DUMB workflow and identity families stay at DUMB despite retained embedded cookies', async () => {
  const calls = []
  const { handler, errors } = await loadProxyHarness({ apiUrl: 'http://api.invalid', traefikUrl: 'http://traefik.invalid', proxy: options => (request, response, done) => { calls.push({ url: request.url, target: options.target }); done() }, fetchImpl: async url => new Response(JSON.stringify(String(url).includes('/config/service-ui?')
    ? { services: [{ name: 'InfiniDysk', config_key: 'infinidysk', runtime_generation: '1' }] }
    : { infinidysk: 'infinidysk', radarr: 'radarr' }), { headers: { 'content-type': 'application/json' } }) })
  const run = async (path, cookie, referer = '/settings#backups') => {
    const headers = new Map()
    await handler({ node: { req: { url: path, method: 'GET', headers: { host: 'example.test', accept: 'application/json', cookie: `dumb_ui_service=${cookie}`, referer: 'http://example.test' + referer } }, res: { setHeader: (key, value) => headers.set(key, value), getHeader: key => headers.get(key), end() {} } } })
    return calls.at(-1)
  }
  for (const cookie of ['infinidysk', 'radarr']) {
    for (const path of ['/api/process/capabilities', '/api/process/installation-backups/status', '/api/process/installation-backups/jobs/example', '/api/process/backup-storage', '/api/process/backup-storage/artifacts?destination_id=example', '/api/process/setup/runs/latest', '/api/process/infinidysk-v2/status', '/api/process/infinidysk-v2/postgres/status', '/api/auth/oidc/start', '/api/auth/oidc/callback']) assert.deepEqual(await run(path, cookie), { url: path, target: 'http://api.invalid' })
  }
  assert.equal((await run('/api/process/setup-foreign', 'infinidysk')).url, '/ui/infinidysk/api/process/setup-foreign')
  assert.equal((await run('/api/process/setup/runs/latest', 'infinidysk', '/ui/infinidysk/')).url, '/ui/infinidysk/api/process/setup/runs/latest')
  assert.deepEqual(errors, [])
})
