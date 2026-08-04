import assert from 'node:assert/strict'
import test from 'node:test'

import {
  MEDIA_PROTECTION_OVERRIDES,
  summarizeMediaProtection,
} from '../helper/mediaProtection.js'

test('media protection override values match the backend contract', () => {
  assert.deepEqual(MEDIA_PROTECTION_OVERRIDES, {
    SAFE: 'safe',
    KEEP_RUNNING: 'keep_running',
    STOP_NOW: 'stop_now',
  })
})

test('media protection summary separates busy and unknown activity', () => {
  const summary = summarizeMediaProtection({
    protected: true,
    blocked: true,
    media_servers: [
      { process_name: 'Plex', activity: { state: 'busy' } },
      { process_name: 'Jellyfin', activity: { state: 'unknown' } },
      { process_name: 'Emby', activity: { state: 'idle' } },
    ],
  })

  assert.equal(summary.protected, true)
  assert.equal(summary.blocked, true)
  assert.equal(summary.serverCount, 3)
  assert.deepEqual(summary.busyNames, ['Plex'])
  assert.deepEqual(summary.unknownNames, ['Jellyfin'])
})

test('media protection summary ignores malformed unprotected payloads', () => {
  assert.deepEqual(summarizeMediaProtection({ media_servers: null }), {
    protected: false,
    blocked: false,
    serverCount: 0,
    busyNames: [],
    unknownNames: [],
  })
})
