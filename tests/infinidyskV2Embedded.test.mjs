import assert from 'node:assert/strict'
import test from 'node:test'
import { infinidyskV2EmbeddedSupported } from '../helper/infinidyskV2.js'

const supported = {
  api_version: '2.24.0',
  infinidysk_v2: true,
  infinidysk_v2_migration_protocol: 1,
  infinidysk_v2_embedded_ui_adapter: true,
  infinidysk_v2_embedded_ui_protocol: 1,
}

test('native v2 embedding requires its explicit compatible browser adapter protocol', () => {
  assert.equal(infinidyskV2EmbeddedSupported(supported), true)
  assert.equal(infinidyskV2EmbeddedSupported({ ...supported, infinidysk_v2_embedded_ui: false }), true)
  for (const capabilities of [
    undefined,
    {},
    { ...supported, api_version: '2.23.9' },
    { ...supported, infinidysk_v2: false },
    { ...supported, infinidysk_v2_migration_protocol: 2 },
    { ...supported, infinidysk_v2_embedded_ui_adapter: false },
    { ...supported, infinidysk_v2_embedded_ui_adapter: 'true' },
    { ...supported, infinidysk_v2_embedded_ui_adapter: undefined, infinidysk_v2_embedded_ui: true },
    { ...supported, infinidysk_v2_embedded_ui_protocol: undefined },
    { ...supported, infinidysk_v2_embedded_ui_protocol: '1' },
    { ...supported, infinidysk_v2_embedded_ui_protocol: 2 },
  ]) assert.equal(infinidyskV2EmbeddedSupported(capabilities), false)
})
