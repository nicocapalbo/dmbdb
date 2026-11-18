import test from 'node:test'
import assert from 'node:assert/strict'
import {
  deferInfiniDyskV2Invitation,
  infinidyskV2InvitationDue,
  infinidyskV2UpgradeInvitationAvailable,
  normalizeInfiniDyskV2InvitationPreference,
} from '../helper/infinidyskV2Invitation.js'

const status = { runtime_generation: '1', mode: 'migrate', eligibility: { ready: true } }
const service = { process_name: 'InfiniDysk', config_key: 'infinidysk', config: { enabled: true, runtime_generation: '1' } }
const defaultPreference = { dismissed: false, snoozedUntil: 0 }

test('the optional upgrade invitation needs an enabled existing v1 service and confirmed migration eligibility', () => {
  assert.equal(infinidyskV2UpgradeInvitationAvailable(status, [service]), true)
  assert.equal(infinidyskV2UpgradeInvitationAvailable(status, [{ ...service, config: { enabled: 'true' } }]), true, 'Legacy enabled representation remains supported')
  assert.equal(infinidyskV2UpgradeInvitationAvailable(status, [{ ...service, config: { enabled: true } }]), true, 'An absent process generation does not override confirmed backend v1 status')
  assert.equal(infinidyskV2UpgradeInvitationAvailable(null, [service]), false)
  assert.equal(infinidyskV2UpgradeInvitationAvailable({}, [service]), false)
  for (const changed of [{ runtime_generation: undefined }, { runtime_generation: 1 }, { runtime_generation: '2' }, { runtime_generation: 'unknown' }, { mode: 'fresh' }, { mode: undefined }, { eligibility: undefined }, { eligibility: { ready: false } }, { eligibility: { ready: 'true' } }]) {
    assert.equal(infinidyskV2UpgradeInvitationAvailable({ ...status, ...changed }, [service]), false, JSON.stringify(changed))
  }
})

test('an absent, disabled or already v2 InfiniDysk never receives the upgrade invitation', () => {
  for (const processes of [undefined, null, {}, [], [null], [{ ...service, config_key: 'sonarr' }], [{ ...service, config_key: 'InfiniDysk' }], [{ ...service, config: undefined }]]) {
    assert.equal(infinidyskV2UpgradeInvitationAvailable(status, processes), false)
  }
  for (const enabled of [false, 'false', undefined, 1, ' true', 'true ', 'TRUE']) {
    assert.equal(infinidyskV2UpgradeInvitationAvailable(status, [{ ...service, config: { enabled } }]), false, String(enabled))
  }
  for (const runtime_generation of ['2', 2]) {
    assert.equal(infinidyskV2UpgradeInvitationAvailable(status, [{ ...service, config: { enabled: true, runtime_generation } }]), false, 'Already-v2 process metadata overrides a stale v1 status')
  }
})

test('missing or malformed preferences default to an undismissed invitation without coercion', () => {
  for (const value of [undefined, null, false, true, 1, '', 'invalid JSON', '{"dismissed":true}', [], [{ dismissed: true }], {}]) {
    assert.deepEqual(normalizeInfiniDyskV2InvitationPreference(value), defaultPreference)
  }
  for (const dismissed of [false, undefined, null, 1, 'true']) {
    assert.deepEqual(normalizeInfiniDyskV2InvitationPreference({ dismissed }), defaultPreference)
  }
  for (const snoozedUntil of [undefined, null, false, true, '', '2000', 0, -1, NaN, Infinity, -Infinity]) {
    assert.deepEqual(normalizeInfiniDyskV2InvitationPreference({ snoozedUntil }), defaultPreference)
  }
})

test('valid stored preferences retain only the dismissal fields and never mutate the input', () => {
  const input = Object.freeze({ dismissed: false, snoozedUntil: 2500.5, unrelated: 'discard' })
  assert.deepEqual(normalizeInfiniDyskV2InvitationPreference(input), { dismissed: false, snoozedUntil: 2500.5 })
  assert.equal(input.unrelated, 'discard')
  assert.deepEqual(normalizeInfiniDyskV2InvitationPreference({ dismissed: true, snoozedUntil: 2500 }), { dismissed: true, snoozedUntil: 0 })
})

test('a timed reminder becomes due exactly at its expiry and stays due afterward', () => {
  const preference = deferInfiniDyskV2Invitation(defaultPreference, 3600, 1000)
  assert.deepEqual(preference, { dismissed: false, snoozedUntil: 4600 })
  assert.equal(infinidyskV2InvitationDue(preference, 1000), false)
  assert.equal(infinidyskV2InvitationDue(preference, 4599.999), false)
  assert.equal(infinidyskV2InvitationDue(preference, 4600), true)
  assert.equal(infinidyskV2InvitationDue(preference, 4601), true)
  assert.equal(infinidyskV2InvitationDue(undefined, 0), true)
})

test('permanent dismissal has no expiry and overrides an earlier timed reminder', () => {
  const preference = deferInfiniDyskV2Invitation({ dismissed: false, snoozedUntil: 4600 }, 'permanent', 1000)
  assert.deepEqual(preference, { dismissed: true, snoozedUntil: 0 })
  for (const now of [0, 4600, 1000000000000]) assert.equal(infinidyskV2InvitationDue(preference, now), false)
})

test('invalid reminder intervals or clocks cannot silently change an existing dismissal', () => {
  const prior = { dismissed: false, snoozedUntil: 4600 }
  for (const duration of [undefined, null, false, true, '', '3600', 0, -1, NaN, Infinity]) {
    assert.deepEqual(deferInfiniDyskV2Invitation(prior, duration, 1000), prior)
    assert.deepEqual(deferInfiniDyskV2Invitation({ dismissed: true }, duration, 1000), { dismissed: true, snoozedUntil: 0 })
  }
  for (const now of [null, '', '1000', -1, NaN, Infinity]) {
    assert.equal(infinidyskV2InvitationDue(prior, now), false)
    assert.deepEqual(deferInfiniDyskV2Invitation(prior, 3600, now), prior)
  }
  assert.deepEqual(deferInfiniDyskV2Invitation(prior, Number.MAX_VALUE, Number.MAX_VALUE), prior)
})
