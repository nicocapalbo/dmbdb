import assert from 'node:assert/strict'
import test from 'node:test'

import {
  sanitizeMermaidIdentifier,
  sanitizeMermaidLabel,
} from '../helper/mermaidText.js'

test('sanitizeMermaidIdentifier restricts identifiers to safe characters', () => {
  assert.equal(sanitizeMermaidIdentifier('service-name/1'), 'service_name_1')
  assert.equal(sanitizeMermaidIdentifier('"; graph TD'), '___graph_TD')
  assert.equal(sanitizeMermaidIdentifier('', 'group'), 'group')
})

test('sanitizeMermaidLabel removes Mermaid control characters and escapes', () => {
  assert.equal(
    sanitizeMermaidLabel('Service"] --> injected["node'),
    'Service -- injected node',
  )
  assert.equal(
    sanitizeMermaidLabel('path\\\\name | unsafe\nnext'),
    'path name unsafe next',
  )
  assert.equal(sanitizeMermaidLabel('', 'Service 1'), 'Service 1')
})
