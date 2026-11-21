// Opt-in disposable issuer for native InfiniDysk integration tests. Never run
// against a real installation or reuse its generated keys outside the fixture.
import http from 'node:http'
import { generateKeyPairSync, randomBytes, createHash, sign, timingSafeEqual } from 'node:crypto'

if (process.env.DUMB_TEST_IFD_V2_DISPOSABLE !== '1') throw new Error('A disposable native test environment is required')
const port = Number(process.env.DUMB_TEST_IFD_OIDC_PORT || 5555)
const issuer = `http://127.0.0.1:${port}`
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'disposable-native-fixture', use: 'sig', alg: 'RS256' }
let authorizationEndpoint
const codes = new Map()
const json = (res, value, status = 200) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(value)) }
const token = claims => {
  const unsigned = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: jwk.kid })).toString('base64url') + '.' + Buffer.from(JSON.stringify(claims)).toString('base64url')
  return unsigned + '.' + sign('RSA-SHA256', Buffer.from(unsigned), privateKey).toString('base64url')
}
const server = http.createServer(async (req, res) => {
  try {
    let body = ''
    for await (const chunk of req) { body += chunk; if (body.length > 16384) throw new Error('Oversized fixture request') }
    if (req.url === '/configure' && req.method === 'POST') {
      const data = JSON.parse(body)
      const url = new URL(data.authorization_endpoint)
      if (url.protocol !== 'https:' || !['127.0.0.1', 'localhost'].includes(url.hostname)) throw new Error('Expected disposable HTTPS authorization endpoint')
      authorizationEndpoint = url.href
      json(res, { ready: true }); return
    }
    if (req.url === '/authorize-code' && req.method === 'POST') {
      const data = JSON.parse(body)
      const code = randomBytes(24).toString('base64url')
      codes.set(code, data)
      json(res, { code }); return
    }
    if (req.url === '/.well-known/openid-configuration') {
      if (!authorizationEndpoint) { json(res, { error: 'unconfigured' }, 503); return }
      json(res, { issuer, authorization_endpoint: authorizationEndpoint, token_endpoint: issuer + '/token', jwks_uri: issuer + '/jwks', response_types_supported: ['code'], subject_types_supported: ['public'], id_token_signing_alg_values_supported: ['RS256'], token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'], code_challenge_methods_supported: ['S256'] }); return
    }
    if (req.url === '/jwks') { json(res, { keys: [jwk] }); return }
    if (req.url === '/token' && req.method === 'POST') {
      const params = new URLSearchParams(body)
      const flow = codes.get(params.get('code'))
      codes.delete(params.get('code'))
      if (!flow || flow.redirect_uri !== params.get('redirect_uri')) { json(res, { error: 'invalid_grant' }, 400); return }
      const actual = createHash('sha256').update(params.get('code_verifier') || '').digest('base64url')
      const expected = String(flow.code_challenge || '')
      if (actual.length !== expected.length || !timingSafeEqual(Buffer.from(actual), Buffer.from(expected))) { json(res, { error: 'invalid_grant' }, 400); return }
      const credentials = String(req.headers.authorization || '').startsWith('Basic ')
        ? Buffer.from(req.headers.authorization.slice(6), 'base64').toString().split(':').map(decodeURIComponent)
        : [params.get('client_id'), params.get('client_secret')]
      if (credentials[0] !== flow.client_id || credentials[1] !== 'disposable-oidc-client-secret') { json(res, { error: 'invalid_client' }, 401); return }
      const now = Math.floor(Date.now() / 1000)
      json(res, { access_token: 'disposable-access-token', token_type: 'Bearer', expires_in: 300, id_token: token({ iss: issuer, aud: flow.client_id, sub: 'disposable-subject', preferred_username: 'fixture_sso', nonce: flow.nonce, iat: now, exp: now + 300 }) }); return
    }
    json(res, { error: 'not_found' }, 404)
  } catch { json(res, { error: 'invalid_fixture_request' }, 400) }
})
server.listen(port, '0.0.0.0', () => process.stdout.write(JSON.stringify({ ready: true, pid: process.pid, port }) + '\n'))
for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => { server.close(() => process.exit(0)); server.closeAllConnections() })
