import test from 'node:test'
import assert from 'node:assert/strict'
import { readSettingsSectionChoice, settingsSectionHashMatches, settingsSectionStorageKey, writeSettingsSectionChoice } from '../helper/settingsSections.js'

const storage = () => ({ values: new Map(), writes: [], getItem(key) { return this.values.get(key) ?? null }, setItem(key, value) { this.values.set(key, value); this.writes.push([key, value]) } })

test('fresh and legacy automatic open state never opens or writes a Settings section', () => {
  const value = storage()
  value.values.set('dmbdb.settings.section.backups.open', 'true')
  assert.equal(readSettingsSectionChoice(value, 'backups'), false)
  value.values.set('dmbdb.settings.section.backups.open', 'false')
  assert.equal(readSettingsSectionChoice(value, 'backups'), false)
  assert.deepEqual(value.writes, [])
  for (const invalid of [true, { open: true }, { schema_version: 1, user_applied: 'true', open: true }, { schema_version: 1, user_applied: true, open: 'true' }]) {
    value.values.set(settingsSectionStorageKey('backups'), JSON.stringify(invalid))
    assert.equal(readSettingsSectionChoice(value, 'backups'), false)
  }
})

test('only explicit boolean user choices persist both opening and closing', () => {
  const value = storage()
  for (const open of [true, false, true]) {
    assert.equal(writeSettingsSectionChoice(value, 'advanced', open), true)
    assert.equal(readSettingsSectionChoice(value, 'advanced'), open)
  }
  assert.equal(writeSettingsSectionChoice(value, 'advanced', 'true'), false)
  assert.equal(value.writes.length, 3)
  assert.deepEqual(JSON.parse(value.writes[2][1]), { schema_version: 1, user_applied: true, open: true })
})

test('storage denial or malformed records cannot block Settings', () => {
  const denied = { getItem() { throw new Error('Denied') }, setItem() { throw new Error('Denied') } }
  assert.equal(readSettingsSectionChoice(denied, 'backups'), false)
  assert.equal(writeSettingsSectionChoice(denied, 'backups', true), false)
  assert.equal(writeSettingsSectionChoice(null, 'backups', true), false)
})

test('hash navigation matches only the exact section without writing any preference', () => {
  for (const hash of ['#backups', '#settings-section-backups', '#back%75ps']) assert.equal(settingsSectionHashMatches(hash, 'backups'), true)
  for (const hash of ['', '#other', '#backups-extra', '#%xx', null]) assert.equal(settingsSectionHashMatches(hash, 'backups'), false)
})
