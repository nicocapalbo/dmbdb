import assert from 'node:assert/strict'
import test from 'node:test'
import { setupFieldGuidance, setupFieldGuidanceMap, setupGuidanceGroups, setupGuidedDecisions, setupGuidanceInvalidatedKeys, setupGuidanceSelectionSignature } from '../helper/setupGuidance.js'

const field = (key, extra = {}) => ({ key, resource_id: key.split('::')[0], service_key: key.split('::')[0].split('.')[0], label: key.split('::').at(-1), type: 'string', ...extra })

test('required connection inputs include their controlling choice without turning every field into a requirement', () => {
  const fields = [
    field('infinidysk::nntp_source', { type: 'select', options: [{ value: 'own', label: 'My accounts' }], default: 'own' }),
    field('infinidysk::nntp', { type: 'nntp_providers', visible_when: { key: 'infinidysk::nntp_source', equals: 'own' } }),
    field('infinidysk::history_days', { type: 'number' }),
  ]
  const actions = [{ id: 'infinidysk::provider', label: 'Connect your Usenet accounts', required: true, input_keys: ['infinidysk::nntp'], missing_inputs: ['infinidysk::nntp'] }]
  const context = { fields, actions, services: [{ id: 'infinidysk', name: 'InfiniDysk' }] }
  assert.equal(setupFieldGuidance(fields[0], context).requirement, 'optional', 'The advertised own-account default does not need another decision')
  assert.equal(setupFieldGuidance({ ...fields[0], default: undefined }, context).requirement, 'required', 'A missing credential still needs its unanswered controlling choice')
  assert.equal(setupFieldGuidance(fields[1], context).serviceName, 'InfiniDysk')
  assert.deepEqual(setupFieldGuidance(fields[1], context).relatedActions, ['Connect your Usenet accounts'])
  assert.equal(setupFieldGuidance(fields[2], context).requirement, 'optional')
  assert.equal(setupFieldGuidance(fields[2], context).advanced, true)
  assert.deepEqual(setupGuidedDecisions(context).map(decision => decision.key), ['infinidysk::nntp_source', 'infinidysk::nntp'])
})

test('required actions do not turn optional default policies into missing user requirements', () => {
  const fields = [
    field('seerr::api_key', { type: 'password' }),
    field('seerr::monitor_existing', { type: 'boolean', default: false }),
    field('seerr::sync_schedule', { type: 'number', optional: true }),
  ]
  const actions = [{ id: 'seerr::connection', required: true, input_fields: fields.map(item => item.key), missing_inputs: fields.map(item => item.key) }]
  assert.equal(setupFieldGuidance(fields[0], { fields, actions }).requirement, 'required')
  assert.equal(setupFieldGuidance(fields[1], { fields, actions }).requirement, 'optional')
  assert.match(setupFieldGuidance(fields[1], { fields, actions }).defaultExplanation, /leaves this option off/)
  assert.equal(setupFieldGuidance(fields[2], { fields, actions }).requirement, 'optional')
  assert.equal(setupFieldGuidance({ ...fields[0], configured: true }, { fields, actions }).requirement, 'optional')
  assert.equal(setupFieldGuidance(fields[0], { fields, actions: [{ ...actions[0], missing_inputs: [] }] }).requirement, 'optional')
})

test('a batched guidance map matches single-field metadata while using the full controller context', () => {
  const fields = [
    field('app::source', { type: 'select', options: [{ value: 'own', label: 'My accounts' }] }),
    field('app::password', { type: 'password', visible_when: { key: 'app::source', equals: 'own' } }),
    field('app::policy', { type: 'boolean', default: false }),
    field('app::profile', { type: 'select', options: [] }),
  ]
  const context = { fields, actions: [{ id: 'connect', required: true, input_fields: fields.map(item => item.key), missing_inputs: ['app::password'] }], services: [{ id: 'app', name: 'Selected app' }] }
  const metadata = setupFieldGuidanceMap(fields, context)
  assert.ok(metadata instanceof Map)
  for (const item of fields) assert.deepEqual(metadata.get(item.key), setupFieldGuidance(item, context))
  const subset = setupFieldGuidanceMap([fields[0]], context)
  assert.equal(subset.get('app::source').requirement, 'required', 'The controlling choice still belongs to the required password task outside the rendered subset')
  assert.deepEqual([...subset.keys()], ['app::source'])
  assert.equal(metadata.get('app::policy').requirement, 'optional')
  assert.equal(metadata.get('app::profile').deferred, true)
})

test('native checks and version choices explain their effects without offering unsupported options', () => {
  const consumer = setupFieldGuidance(field('sonarr.TV::consumer_paths', { type: 'list' }))
  const workflow = setupFieldGuidance(field('sonarr.TV::workflow_probe', { type: 'object' }))
  assert.match(consumer.label, /read your library/)
  assert.match(consumer.description, /after startup|limited sample/)
  assert.equal(consumer.advanced, true)
  assert.match(workflow.description, /never runs it automatically/)
  assert.equal(workflow.advanced, true)
  assert.match(setupFieldGuidance(field('infinidysk::mount_backend')).description, /rclone.*Native FUSE/)
  assert.match(setupFieldGuidance(field('lidarr::metadata_profile')).description, /Existing artists keep their settings/)
  const connection = field('seerr::media_server', { type: 'connection', options: [{ value: 'plex', label: 'Plex' }] })
  assert.doesNotMatch(setupFieldGuidance(connection).description, /External means|None leaves/)
})

test('conditional choices use advertised controller defaults and preserve hidden drafts', () => {
  const fields = [
    field('seerr::external', { type: 'external_service', visible_when: { key: 'seerr::media_server', equals: 'external' } }),
    field('seerr::media_server', { type: 'connection', default: 'none', options: [{ value: 'none', label: 'No media server' }, { value: 'external', label: 'Existing external server' }] }),
  ]
  const values = { 'seerr::external': { url: 'https://media.example.invalid', api_key: 'private-fixture-value' } }
  const original = structuredClone(values)
  assert.deepEqual(setupGuidedDecisions({ fields, values }).map(decision => decision.key), ['seerr::media_server'])
  values['seerr::media_server'] = 'external'
  assert.deepEqual(setupGuidedDecisions({ fields, values }).map(decision => decision.key), ['seerr::media_server', 'seerr::external'])
  assert.deepEqual(values['seerr::external'], original['seerr::external'])
  assert.doesNotMatch(JSON.stringify(setupFieldGuidance(fields[1], { fields, values })), /private-fixture-value|media\.example/)
})

test('resource dependencies and action prerequisites override display priority', () => {
  const fields = [
    field('seerr::token', { required: true }),
    field('sonarr.TV::profile', { required: true, type: 'select', options: [{ value: 'native-4', label: 'Existing profile' }] }),
    field('postgres::setting', { required: true }),
  ]
  const services = [{ id: 'postgres', required_by: ['sonarr.TV'] }, { id: 'sonarr.TV' }, { id: 'seerr' }]
  const actions = [
    { id: 'arr-profile', input_fields: ['sonarr.TV::profile'], required: true },
    { id: 'request-connection', input_fields: ['seerr::token'], prerequisites: ['arr-profile'], required: true },
  ]
  assert.deepEqual(setupGuidedDecisions({ fields, services, actions }).map(decision => decision.key), ['postgres::setting', 'sonarr.TV::profile', 'seerr::token'])
})

test('unavailable native catalogs are deferred without inventing choices or values', () => {
  const fields = [field('seerr::sonarr.TV::quality_profile', { type: 'select', options: [], required: true })]
  const decisions = setupGuidedDecisions({ fields })
  assert.equal(decisions.length, 1)
  assert.equal(decisions[0].deferred, true)
  assert.equal(decisions[0].unavailableKind, 'native')
  assert.equal(decisions[0].requirement, 'required')
  assert.deepEqual(decisions[0].field.options, [])
  assert.equal('default' in decisions[0].field, false)
  assert.equal(setupFieldGuidance({ ...fields[0], options: [{ value: 12, label: 'Native profile' }] }).deferred, false)
})

test('an empty compatible-app inventory requires a selection change rather than promising startup choices', () => {
  for (const key of ['prowlarr::arr_instances', 'profilarr::arrs']) {
    const selected = field(key, { type: 'multiselect', options: [] })
    const guidance = setupFieldGuidance(selected, { fields: [selected], actions: [{ id: 'connect', required: true, missing_inputs: [key] }] })
    assert.equal(guidance.unavailableKind, 'selection')
    assert.equal(guidance.deferred, false)
    assert.equal(guidance.requirement, 'optional')
    assert.match(guidance.choiceHelp, /No compatible library apps are selected/)
    assert.doesNotMatch(guidance.choiceHelp, /after startup|app startup|once.*running/i)
    assert.equal(setupGuidedDecisions({ fields: [selected] })[0].deferred, false)
  }
})

test('optional fine tuning is explicit while expert groups retain readonly and unknown advertised settings', () => {
  const fields = [
    field('plex::libraries', { type: 'libraries' }),
    field('plex::scan_on_create', { type: 'boolean', default: false }),
    field('plex::native_contract', { readonly: true, default: 'preserved' }),
    field('plex::vendor_choice', { type: 'future_type' }),
    field('plex::private_marker', { internal: true }),
  ]
  assert.deepEqual(setupGuidedDecisions({ fields }).map(decision => decision.key), ['plex::libraries'])
  assert.deepEqual(new Set(setupGuidedDecisions({ fields, includeOptional: true }).map(decision => decision.key)), new Set(['plex::libraries', 'plex::scan_on_create', 'plex::vendor_choice']))
  const groups = setupGuidanceGroups({ services: [{ id: 'plex', name: 'Plex Media Server' }] }, fields)
  assert.equal(groups[0].name, 'Plex Media Server')
  assert.deepEqual(groups[0].fields.map(item => item.key), ['plex::libraries', 'plex::scan_on_create', 'plex::native_contract', 'plex::vendor_choice'])
})

test('fresh discovery replaces a duplicate catalog without duplicating or dropping a question', () => {
  const first = field('sonarr.TV::quality_profile', { type: 'select', options: [], required: true })
  const discovered = { ...first, options: [{ value: 12, label: 'Native profile' }] }
  const decisions = setupGuidedDecisions({ fields: [first, discovered] })
  assert.equal(decisions.length, 1)
  assert.equal(decisions[0].deferred, false)
  assert.deepEqual(decisions[0].field.options, discovered.options)
})

test('cycles remain deterministic and retain every advertised decision', () => {
  const fields = [field('app::first', { required: true }), field('app::second', { required: true })]
  const actions = [
    { id: 'one', input_keys: ['app::first'], prerequisites: ['two'] },
    { id: 'two', input_keys: ['app::second'], prerequisites: ['one'] },
  ]
  assert.deepEqual(setupGuidedDecisions({ fields, actions }).map(decision => decision.key), ['app::first', 'app::second'])
})

test('changed connections invalidate review in their scope and dependent choices without altering entries', () => {
  const fields = [
    field('seerr::arr_instances', { type: 'multiselect', options: [] }),
    field('seerr::profile', { visible_when: { key: 'seerr::arr_instances', equals: 'selected' } }),
    field('plex::libraries', { type: 'libraries' }),
    field('shared::route', { visible_when: { key: 'seerr::profile', equals: 'external' } }),
  ]
  assert.deepEqual(new Set(setupGuidanceInvalidatedKeys(fields, ['seerr::arr_instances'])), new Set(['seerr::arr_instances', 'seerr::profile', 'shared::route']))
  assert.deepEqual(setupGuidanceInvalidatedKeys(fields, []), [])
  assert.deepEqual(setupGuidanceInvalidatedKeys([...fields, field('setup::external_arrs')], ['setup::external_arrs']).sort(), [...fields.map(item => item.key), 'setup::external_arrs'].sort())
})

test('review context changes for app identities and guided intent but excludes private configuration and plan churn', () => {
  const context = {
    coreServices: [{ name: 'sonarr', instance_name: 'TV', service_options: { url: 'https://private.example.invalid', api_key: 'private-fixture-secret' } }],
    optionalServices: ['prowlarr', { key: 'seerr', service_options: { password: 'private-fixture-password' } }],
    guidedWorkflowIntent: { mediaServer: 'plex', stack: 'usenet', usenetClient: 'infinidysk', usenetCoreServices: ['infinidysk'], private_value: 'private-fixture-value' },
    services: [{ id: 'sonarr.TV', name: 'Display name' }, { id: 'postgres' }],
    plan_id: 'old-plan',
  }
  const signature = setupGuidanceSelectionSignature(context)
  assert.doesNotMatch(signature, /private|https:|api_key|password|plan_id|old-plan|Display name/)
  assert.equal(setupGuidanceSelectionSignature({ ...context, plan_id: 'new-plan', optionalServices: [...context.optionalServices].reverse(), services: [...context.services].reverse() }), signature)
  assert.notEqual(setupGuidanceSelectionSignature({ ...context, coreServices: [{ name: 'sonarr', instance_name: '4K' }] }), signature)
  assert.notEqual(setupGuidanceSelectionSignature({ ...context, guidedWorkflowIntent: { ...context.guidedWorkflowIntent, mediaServer: 'external' } }), signature)
  assert.notEqual(setupGuidanceSelectionSignature({ ...context, services: [...context.services, { id: 'rclone.InfiniDysk' }] }), signature)
})
