import assert from 'node:assert/strict'
import test from 'node:test'

import axios from 'axios'

import { logsRepository } from '../services/logs.js'

test('forwards the log file generation with incremental cursor requests', async () => {
  const originalGet = axios.get
  let capturedConfig

  axios.get = async (_url, config) => {
    capturedConfig = config
    return {
      data: {
        cursor: 42,
        file_id: 'generation-2',
        chunk: '',
        reset: false
      }
    }
  }

  try {
    const response = await logsRepository().fetchServiceLogs('Example', {
      cursor: 21,
      tail_bytes: 262_144,
      file_id: 'generation-1'
    })

    assert.deepEqual(capturedConfig.params, {
      process_name: 'Example',
      cursor: 21,
      tail_bytes: 262_144,
      file_id: 'generation-1'
    })
    assert.equal(response.file_id, 'generation-2')
  } finally {
    axios.get = originalGet
  }
})
