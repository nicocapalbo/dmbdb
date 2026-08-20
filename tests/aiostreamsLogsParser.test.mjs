import assert from 'node:assert/strict'
import test from 'node:test'

import { parseAioStreamsLogs } from '../helper/aiostreamsLogsParser.js'

test('promotes AIOStreams Pino NDJSON inside a DUMB subprocess wrapper', () => {
  const record = JSON.stringify({
    level: 40,
    time: '2026-08-20T12:34:56.000Z',
    module: 'oidc',
    msg: 'Provider response required attention',
    requestId: 'example-request',
  })
  const [entry] = parseAioStreamsLogs(
    `2026-08-20 12:34:55,000 - INFO - AIOStreams subprocess: ${record}`,
    'AIOStreams',
  )

  assert.equal(entry.timestamp.toISOString(), '2026-08-20T12:34:56.000Z')
  assert.equal(entry.level, 'WARNING')
  assert.equal(entry.process, 'oidc')
  assert.match(entry.message, /Provider response required attention/)
  assert.match(entry.message, /requestId=example-request/)
})

test('promotes downloaded AIOStreams JSON errors and structured context', () => {
  const record = JSON.stringify({
    level: 'error',
    time: 1787227200000,
    component: 'database',
    message: 'Migration failed',
    attempt: 2,
  })
  const [entry] = parseAioStreamsLogs(
    `[2026-08-20T12:00:00.000Z] [INFO] [AIOStreams] ${record}`,
  )

  assert.equal(entry.timestamp.toISOString(), '2026-08-20T12:00:00.000Z')
  assert.equal(entry.level, 'ERROR')
  assert.equal(entry.process, 'database')
  assert.equal(entry.message, 'Migration failed attempt=2')
})

test('keeps AIOStreams text-format output readable', () => {
  const [entry] = parseAioStreamsLogs(
    '2026-08-20 12:00:00,000 - INFO - AIOStreams subprocess: server listening on port 3006',
  )

  assert.equal(entry.level, 'INFO')
  assert.equal(entry.process, 'AIOStreams')
  assert.equal(entry.message, 'server listening on port 3006')
})
