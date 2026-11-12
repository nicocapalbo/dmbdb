import assert from 'node:assert/strict'
import test from 'node:test'
import { openServiceUtility } from '../helper/serviceUtilityNavigation.js'

test('Settings shortcuts open only the existing eligible service utility', () => {
  const calls = []
  const groups = [{ items: [
    { id: 'symlinks', visible: true, onSelect: () => calls.push('symlinks') },
    { id: 'service-reset', visible: true, onSelect: () => calls.push('reset') },
    { id: 'library-protection', visible: false, onSelect: () => calls.push('protection') },
    { id: 'database-migration', visible: true, disabled: true, description: 'Complete the namespace migration first.', onSelect: () => calls.push('migration') },
  ] }]
  assert.deepEqual(openServiceUtility('symlinks', groups), { status: 'opened' })
  assert.equal(openServiceUtility('service-reset', groups).status, 'unknown')
  assert.equal(openServiceUtility(['symlinks'], groups).status, 'unknown')
  assert.match(openServiceUtility('library-protection', groups).message, /unavailable/)
  assert.equal(openServiceUtility('database-health', groups).status, 'unavailable')
  assert.equal(openServiceUtility('database-migration', groups).message, 'Complete the namespace migration first.')
  assert.deepEqual(calls, ['symlinks'])
})


test('opening an eligible shortcut reveals its parent tab without toggling an already open tool closed', () => {
  const calls = []
  const tool = {id:'symlinks',visible:true,status:'Open',onSelect:()=>calls.push('toggle')}
  assert.equal(openServiceUtility('symlinks',[{items:[tool]}],()=>calls.push('tab')).status,'opened')
  assert.deepEqual(calls,['tab'])
  assert.equal(openServiceUtility('symlinks',[{items:[{...tool,disabled:true}]}],()=>calls.push('blocked-tab')).status,'blocked')
  assert.deepEqual(calls,['tab'])
})
