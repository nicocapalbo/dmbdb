import test from 'node:test'
import assert from 'node:assert/strict'
import { infinidyskV2ProviderDiagnostics } from '../helper/infinidyskV2Providers.js'

const sample = () => ({ schema_version: 1, final: true, recorded_at: 1234, providers: [
  { provider_ordinal: 1, requests: 7, bytes_received: 800, retries: 2, failures: { timeout: 2, article_missing: 1 } },
], unbound_failures: { bridge_handshake: 1 } })

test('provider observations retain fixed category labels without raw upstream details', () => {
  const raw = sample()
  raw.providers[0].host = 'private.example.invalid'
  raw.providers[0].failures['private-error-message'] = 3
  raw.unbound_failures['private-message'] = 4
  raw.password = 'private-password'
  const result = infinidyskV2ProviderDiagnostics(raw)
  assert.equal(result.final, true)
  assert.deepEqual(result.providers[0], { ordinal: 1, requests: 7, bytesReceived: 800, retries: 2,
    missing: 1, errors: [{ key: 'timeout', label: 'Timed out', count: 2 }] })
  assert.deepEqual(result.unbound, [{ key: 'bridge_handshake', label: 'Bridge handshake', count: 1 }])
  assert.doesNotMatch(JSON.stringify(result), /private/)
})

test('malformed or unsupported provider diagnostics do not masquerade as confirmed observations', () => {
  for (const value of [null, {}, { ...sample(), schema_version: true }, { ...sample(), schema_version: 2 },
    { ...sample(), providers: sample().providers.concat(sample().providers) }, { ...sample(), final: 'true' },
    { ...sample(), recorded_at: -1 }, { ...sample(), unbound_failures: { timeout: true } },
    { ...sample(), unbound_failures: 0 }]) {
    assert.equal(infinidyskV2ProviderDiagnostics(value), null)
  }
  for (const key of ['provider_ordinal', 'requests', 'bytes_received', 'retries']) for (const invalid of [true, -1, '2', 2 ** 53]) {
    const value = sample(); value.providers[0][key] = invalid
    assert.equal(infinidyskV2ProviderDiagnostics(value), null, key)
  }
  const value = sample(); value.providers[0].failures.timeout = -1
  assert.equal(infinidyskV2ProviderDiagnostics(value), null)
})
