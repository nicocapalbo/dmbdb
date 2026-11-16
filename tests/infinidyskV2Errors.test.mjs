import assert from 'node:assert/strict'
import test from 'node:test'
import { infinidyskV2ErrorText } from '../helper/infinidyskV2.js'

const endpoint = '/api/process/infinidysk-v2/preview'

test('authored conflict detail keeps safe HTTP and canonical endpoint context', () => {
  assert.equal(infinidyskV2ErrorText({
    response: { status: 409, data: { detail: 'Another migration is active.' } },
    config: { url: endpoint + '?preview_token=fixture-private#private-fragment' },
  }), 'Another migration is active. (HTTP 409 · ' + endpoint + ')')
})

test('Axios preview timeout explains an unconfirmed response without claiming backend failure', () => {
  const text = infinidyskV2ErrorText({
    code: 'ECONNABORTED', message: 'timeout at https://user:fixture-private@example.invalid/ password=fixture-private',
    config: { url: endpoint, timeout: 60000, headers: { authorization: 'fixture-private' } },
  })
  assert.match(text, /timed out before a response/)
  assert.match(text, /DUMB may still be working/)
  assert.match(text, /Refresh status before trying again/)
  assert.ok(text.endsWith('(' + endpoint + ')'))
  assert.equal(text.includes('fixture-private'), false)
  assert.equal(text.includes('60000'), false)
})

test('network failures have distinct guidance and omit raw error context', () => {
  const text = infinidyskV2ErrorText({
    code: 'ERR_NETWORK', request: { responseURL: 'https://fixture-private.invalid/' },
    message: 'fixture-private', config: { url: endpoint + '/start' },
  })
  assert.match(text, /could not be reached/)
  assert.match(text, /frontend proxy connection/)
  assert.equal(text.includes('timed out'), false)
  assert.equal(text.includes('fixture-private'), false)
})

test('proxy HTML and arbitrary messages never become API error detail', () => {
  for (const data of ['<html>fixture-private</html>', { detail: '<html>fixture-private</html>' }, ['fixture-private']]) {
    const text = infinidyskV2ErrorText({ response: { status: 502, data }, message: 'fixture-private', config: { url: endpoint } })
    assert.match(text, /DUMB API could not complete/)
    assert.match(text, /HTTP 502/)
    assert.equal(text.includes('fixture-private'), false)
    assert.equal(text.includes('<'), false)
  }
})

test('text JSON report errors retain authored detail without changing no-status compatibility', () => {
  assert.equal(infinidyskV2ErrorText({ response: { data: JSON.stringify({ detail: 'Report unavailable https://example.invalid/?token=hidden' }) } }),
    'Report unavailable [URL omitted]')
  assert.equal(infinidyskV2ErrorText({ data: { detail: { message: 'Preview uses an unsupported InfiniDysk 2 protocol.' } } }),
    'Preview uses an unsupported InfiniDysk 2 protocol.')
  assert.equal(infinidyskV2ErrorText(new Error('Preview uses an unsupported InfiniDysk 2 protocol.')),
    'The request could not be confirmed. Refresh status before trying again.')
})

test('authored detail redacts quoted secrets, bearer credentials, other URL schemes and signed paths', () => {
  const text = infinidyskV2ErrorText({ response: { data: { detail: 'Read redis://user:fixture-private@example.invalid/store; preview_token="fixture private"; Authorization: Bearer fixture-private; Cookie: session=fixture-private; /.ids/fixture-private' } } })
  assert.match(text, /\[URL omitted\]/)
  assert.match(text, /\[redacted\]/)
  assert.match(text, /\[signed path omitted\]/)
  assert.equal(text.includes('fixture'), false)
  assert.equal(text.includes('redis://'), false)
})

test('422 diagnostics use bounded known fields and standard reasons, excluding input, context and custom messages', () => {
  const detail = [
    { loc: ['body', 'mount_backend'], type: 'literal_error', msg: 'fixture-private', input: 'fixture-private', ctx: { expected: 'fixture-private' } },
    { loc: ['body', 'offload_legacy_blobs'], type: 'bool_parsing', msg: 'fixture-private', input: 'fixture-private' },
    { loc: ['body', 'acknowledgements', 'external_blob_staging'], type: 'missing', ctx: { error: 'fixture-private' } },
    { loc: ['body', 'password'], type: 'missing', input: 'fixture-private' },
  ]
  const text = infinidyskV2ErrorText({ response: { status: 422, data: { detail } }, config: { url: endpoint } })
  assert.match(text, /mount_backend: invalid choice/)
  assert.match(text, /offload_legacy_blobs: must be true or false/)
  assert.match(text, /acknowledgements.external_blob_staging: required/)
  assert.equal(text.includes('password'), false, 'Only three validation rows are displayed')
  assert.equal(text.includes('fixture-private'), false)
  assert.match(text, /HTTP 422/)
})

test('untrusted validation field names and malformed rows never expose supplied values', () => {
  const text = infinidyskV2ErrorText({ response: { status: 422, data: { detail: [
    { loc: ['body', 'fixture-private'], type: { toString: 'fixture-private' }, msg: 'fixture-private' }, null,
    { loc: ['body', { private: 'fixture-private' }], type: 'missing' },
  ] } } })
  assert.match(text, /request field: invalid value/)
  assert.equal(text.includes('fixture-private'), false)
})

test('task and job identifiers become canonical placeholders and absolute URLs lose credentials and queries', () => {
  const cases = [
    ['/process/infinidysk-v2/preview/task/task-private/cancel?token=fixture-private', '/api/process/infinidysk-v2/preview/task/{task_id}/cancel'],
    ['https://user:fixture-private@example.invalid/api/process/infinidysk-v2/preview/task/task-private?token=fixture-private', '/api/process/infinidysk-v2/preview/task/{task_id}'],
    ['/api/process/infinidysk-v2/jobs/job-private/report?token=fixture-private', '/api/process/infinidysk-v2/jobs/{job_id}/report'],
    ['/api/process/infinidysk-v2/postgres/preview', '/api/process/infinidysk-v2/postgres/preview'],
    ['/api/process/capabilities', '/api/process/capabilities'],
  ]
  for (const [url, expected] of cases) {
    const text = infinidyskV2ErrorText({ response: { status: 503 }, config: { url } })
    assert.ok(text.endsWith('(HTTP 503 · ' + expected + ')'), text)
    assert.equal(text.includes('fixture-private'), false)
    assert.equal(text.includes('task-private'), false)
    assert.equal(text.includes('job-private'), false)
    assert.equal(text.includes('example.invalid'), false)
  }
})

test('unknown endpoints and malformed statuses contribute no attacker-controlled context', () => {
  for (const status of [null, '409', [409], 0, 99, 600, NaN]) {
    const text = infinidyskV2ErrorText({ response: { status }, config: { url: '/api/process/fixture-private?token=fixture-private' }, message: 'fixture-private' })
    assert.equal(text.includes('HTTP'), false)
    assert.equal(text.includes('fixture-private'), false)
  }
})

test('authored messages and JSON error bodies remain bounded', () => {
  const text = infinidyskV2ErrorText({ response: { status: 409, data: { detail: 'x'.repeat(15000) } }, config: { url: endpoint } })
  assert.ok(text.length < 1700)
  assert.match(infinidyskV2ErrorText({ response: { data: JSON.stringify({ detail: 'fixture-private' }).padEnd(16001, ' ') } }), /could not be confirmed/)
})
