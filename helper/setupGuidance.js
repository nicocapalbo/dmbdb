import { setupFieldIsSecret, setupFieldVisible } from './setupArrangements.js'

const stages = {
  access: { label: 'Accounts and access', order: 0 },
  storage: { label: 'Downloads and storage', order: 1 },
  connections: { label: 'Connect your apps', order: 2 },
  libraries: { label: 'Media libraries', order: 3 },
  policies: { label: 'Quality and preferences', order: 4 },
  extras: { label: 'Optional checks and access', order: 5 },
}
const inputKeys = action => [...new Set([
  ...(action.input_fields || []), ...(action.input_keys || []), ...(action.missing_inputs || []),
].map(input => typeof input === 'string' ? input : input?.key).filter(Boolean))]
const uniqueFields = fields => [...new Map((fields || []).filter(field => field?.key && !field.internal).map(field => [field.key, field])).values()]
const resourceId = field => field.resource_id || String(field.key).split('::')[0] || field.service_key

function actionFields(action, fields, selectedKeys = inputKeys(action)) {
  const keys = new Set(selectedKeys)
  let changed = true
  while (changed) {
    changed = false
    for (const field of fields) {
      if (keys.has(field.key) && field.visible_when?.key && !keys.has(field.visible_when.key)) {
        keys.add(field.visible_when.key)
        changed = true
      }
    }
  }
  return keys
}

function bindingsByField(fields, actions, select = inputKeys) {
  const bindings = new Map()
  for (const action of actions) {
    for (const key of actionFields(action, fields, select(action))) {
      if (!bindings.has(key)) bindings.set(key, [])
      bindings.get(key).push(action)
    }
  }
  return bindings
}

const missingKeys = action => (action.missing_inputs || []).map(input => typeof input === 'string' ? input : input?.key).filter(Boolean)
const hasDefault = field => {
  const value = field.default ?? field.default_value
  return value !== undefined && value !== null && value !== ''
}

function friendlyCopy(field, serviceName) {
  const name = String(field.key).split('::').at(-1)
  const family = field.service_key || String(field.key).split('::')[0].split('.')[0]
  if (name === 'consumer_paths') return {
    label: 'Check this app can read your library',
    description: 'Optional, after startup. Choose the library paths this app should see. DUMB checks access and can read a limited sample; it does not repair mounts or prove that every file plays.',
  }
  if (name === 'workflow_probe') return {
    label: 'Try a download-to-playback test',
    description: 'Optional, after setup. Choose one existing item and authorize a limited test. It can download, import and contact your media server, so starting services never runs it automatically.',
  }
  if (name === 'runtime_generation') return {
    label: 'Which InfiniDysk version do you want?',
    description: 'InfiniDysk 1 keeps the historical setup. InfiniDysk 2 opens its installation or migration wizard before setup can continue. Changing this choice alone does not upgrade existing data.',
  }
  if (name === 'mount_backend') return {
    label: 'How should apps access the InfiniDysk library?',
    description: 'rclone / WebDAV keeps the historical mount. Native FUSE uses the InfiniDysk 2 mount. DUMB keeps the existing library path when switching through its guarded wizard.',
  }
  if (name === 'nntp_source') return {
    label: 'Which Usenet accounts should this app use?',
    description: 'Use your own accounts or reuse accounts from another selected provider. Reusing saved details still requires a separate connection budget for each app.',
  }
  if (field.type === 'nntp_providers') return {
    label: 'Add your Usenet provider accounts',
    description: 'Enter your provider server, sign-in details and connection limits. Use accounts you already have; DUMB does not create a provider account for you.',
  }
  if (name === 'arr_instances' || name === 'arrs') return {
    label: `Which movie, TV or music apps should ${serviceName} connect to?`,
    description: "Select the exact app instances you want. Use 'Choose no connections' if you want this integration off; an unselected app will not be connected.",
  }
  if (family === 'lidarr' && name === 'root_folder') return {
    label: 'Which music library folder should Lidarr use?',
    description: 'Choose an existing root folder from Lidarr. If the folder is missing, add it in Lidarr after startup, then return to this task. This choice does not move or import your music.',
  }
  if (family === 'lidarr' && name === 'quality_profile') return {
    label: 'Which music quality rules should this folder use?',
    description: 'Choose an existing Lidarr quality profile for this root folder. It sets the defaults for new use of the folder; DUMB keeps the settings on existing artists.',
  }
  if (family === 'lidarr' && name === 'metadata_profile') return {
    label: 'Which Lidarr metadata profile should this folder use?',
    description: 'Choose the existing Lidarr metadata rules for this root folder. If the profile you want is missing, configure it in Lidarr after startup. Existing artists keep their settings.',
  }
  if (name === 'quality_profile') return {
    label: field.label || 'Choose the quality rules for this connection',
    description: 'Choose a profile that exists in the selected movie or TV app. An instance name such as 1080p or 4K does not set its quality rules. DUMB loads the actual profiles when that app is available.',
  }
  if (field.type === 'libraries') return {
    label: field.label || 'Choose your media libraries',
    description: 'Name each library and choose paths as this media app sees them. Matching libraries are reused; creating missing libraries is an explicit choice.'
      + (field.supports_scan_on_create === true ? ' A scan of a new library is a separate choice.' : ''),
  }
  if (field.type === 'connection') return {
    label: field.label || 'Which app should this service connect to?',
    description: 'Choose one of the available apps for this connection.'
      + (field.options?.some(option => option.value === 'external') ? ' External means an existing app outside this setup.' : '')
      + (field.options?.some(option => option.value === 'none') ? ' None leaves this connection off.' : ''),
  }
  return { label: field.label || 'App setting', description: field.description || '' }
}

function defaultExplanation(field) {
  if (field.configured === true) return 'Your saved value is kept unless you replace it.'
  if (setupFieldIsSecret(field)) return 'If you do not have this credential yet, the connection stays unfinished in the review.'
  if (hasDefault(field)) {
    const value = field.default ?? field.default_value
    if (typeof value === 'boolean') return value ? 'The current default turns this option on.' : 'The current default leaves this option off.'
    const option = field.options?.find(option => String(option.value) === String(value))
    return option ? `The current default is ${option.label}. Keep it unless you want a different setup.` : 'The current default is already filled in. Keep it unless you need a different setup.'
  }
  return 'Unanswered connection tasks remain on your checklist; they are not marked complete.'
}

function stageFor(field) {
  if (Object.hasOwn(stages, field.guidance_stage)) return field.guidance_stage
  const name = String(field.key).split('::').slice(1).join('::').toLowerCase()
  if (field.type === 'external_service' || field.type === 'nntp_providers'
    || /auth|password|passwd|credential|api_key|token|account|nntp|external_arrs/.test(name)) return 'access'
  if (/runtime_generation|mount_backend|mount_path|import_dir|import_strategy|battery_mode|consumer_paths|download_client/.test(name)) return 'storage'
  if (field.type === 'connection' || name === 'arrs' || /arr_instances|media_server/.test(name)) return 'connections'
  if (field.type === 'libraries' || /library|root_folder/.test(name)) return 'libraries'
  if (/profile|quality|language|upgrade|retention|monitor|policy|schedule/.test(name)) return 'policies'
  return 'extras'
}

function unavailableChoices(field) {
  if (field.readonly === true || !['select', 'connection', 'multiselect'].includes(field.type) || field.options?.length) return null
  return /::(?:arr_instances|arrs)$/.test(field.key) ? 'selection' : 'native'
}

export function setupFieldGuidance(field, { fields = [], values = {}, actions = [], services = [], actionBindings = null, requiredBindings = null } = {}) {
  const advertised = actionBindings ? fields : uniqueFields(fields)
  const related = (actionBindings || bindingsByField(advertised, actions)).get(field.key) || []
  const missing = (requiredBindings || bindingsByField(advertised, actions.filter(action => action.required === true), missingKeys)).get(field.key) || []
  const unavailableKind = unavailableChoices(field)
  const required = field.required === true || (field.optional !== true && !hasDefault(field) && field.configured !== true && missing.length > 0 && unavailableKind !== 'selection')
  const stage = stageFor(field)
  const service = services.find(service => service.id === resourceId(field))
  const serviceName = service?.name || field.group_label || (resourceId(field) === 'setup' ? 'Existing apps' : field.service_key) || 'Shared choices'
  const copy = friendlyCopy(field, serviceName)
  const commonChoice = ['connection', 'libraries', 'nntp_providers', 'external_service'].includes(field.type)
    || /::(?:runtime_generation|mount_backend|battery_mode|arr_instances|arrs|nntp_source|media_server|external_arrs)$/.test(field.key)
    || advertised.some(child => child.visible_when?.key === field.key)
  const deferred = unavailableKind === 'native'
  return {
    label: field.guidance_label || copy.label,
    description: field.guidance_description || copy.description,
    defaultExplanation: defaultExplanation(field),
    requirement: required ? 'required' : 'optional',
    requirementLabel: required ? 'Required for this connection' : 'Optional',
    deferred,
    unavailableKind,
    choiceHelp: unavailableKind === 'selection'
      ? 'No compatible library apps are selected. Add one or leave this integration off.'
      : unavailableKind === 'native' ? 'Choices are not available yet. Finish the app startup or setup, then return to this task.' : '',
    advanced: !required && (field.advanced === true || !commonChoice),
    readonly: field.readonly === true,
    serviceName,
    stage,
    stageLabel: stages[stage].label,
    relatedActions: related.map(action => action.label).filter(Boolean),
  }
}

export function setupFieldGuidanceMap(renderedFields = [], context = {}) {
  const fields = uniqueFields(context.fields?.length ? context.fields : renderedFields)
  const actions = context.actions || []
  const indexed = {
    ...context,
    fields,
    actionBindings: bindingsByField(fields, actions),
    requiredBindings: bindingsByField(fields, actions.filter(action => action.required === true), missingKeys),
  }
  return new Map(uniqueFields(renderedFields).map(field => [field.key, setupFieldGuidance(field, indexed)]))
}

export function setupGuidanceGroups(plan = {}, fields = []) {
  const grouped = new Map()
  for (const field of uniqueFields(fields)) {
    const id = resourceId(field)
    const resource = (plan.services || []).find(service => service.id === id)
    const metadata = (plan.arrangement_schema?.groups || []).find(group => (group.resource_id || group.id) === id)
    if (!grouped.has(id)) grouped.set(id, {
      id,
      name: metadata?.label || metadata?.name || field.group_label || resource?.name || (id === 'setup' ? 'Existing apps' : field.service_key) || 'Shared choices',
      fields: [],
    })
    grouped.get(id).fields.push(field)
  }
  return [...grouped.values()]
}

// Order only advertised choices. Dependency cycles or unknown metadata never
// discard a field, and native choice IDs/defaults are never invented here.
export function setupGuidedDecisions({ fields = [], values = {}, actions = [], services = [], includeOptional = false } = {}) {
  const advertised = uniqueFields(fields)
  const context = { fields: advertised, values, actions, services,
    actionBindings: bindingsByField(advertised, actions),
    requiredBindings: bindingsByField(advertised, actions.filter(action => action.required === true), missingKeys),
  }
  const candidates = advertised.filter(field => !field.readonly && setupFieldVisible(field, values, advertised)).map((field, index) => ({
    key: field.key, field, index, ...setupFieldGuidance(field, context),
  }))
  const byKey = new Map(candidates.map(decision => [decision.key, decision]))
  const dependencies = new Map(candidates.map(decision => [decision.key, new Set()]))
  const add = (target, before) => {
    if (target !== before && byKey.has(target) && byKey.has(before)) dependencies.get(target).add(before)
  }
  const owned = id => candidates.filter(decision => resourceId(decision.field) === id).map(decision => decision.key)
  for (const decision of candidates) if (decision.field.visible_when?.key) add(decision.key, decision.field.visible_when.key)
  for (const service of services) {
    for (const parent of service.required_by || []) {
      for (const target of owned(parent)) for (const before of owned(service.id)) add(target, before)
    }
  }
  const byAction = new Map(actions.map(action => [action.id, action]))
  for (const action of actions) {
    for (const prerequisite of action.prerequisites || []) {
      const id = typeof prerequisite === 'string' ? prerequisite : prerequisite?.id
      const before = byAction.has(id) ? [...actionFields(byAction.get(id), advertised)] : owned(id)
      for (const target of actionFields(action, advertised)) for (const key of before) add(target, key)
    }
  }
  const compare = (left, right) => stages[left.stage].order - stages[right.stage].order
    || Number(left.advanced) - Number(right.advanced) || left.index - right.index
  const remaining = new Map(candidates.map(decision => [decision.key, decision]))
  const ordered = []
  while (remaining.size) {
    const ready = [...remaining.values()].filter(decision => [...dependencies.get(decision.key)].every(key => !remaining.has(key)))
    const decision = (ready.length ? ready : [...remaining.values()]).sort(compare)[0]
    ordered.push(decision)
    remaining.delete(decision.key)
  }
  return ordered.filter(decision => includeOptional || !decision.advanced)
}

// A changed connection can reveal another app's native choices. Review its
// resource again, without deleting the user's draft values or credentials.
export function setupGuidanceInvalidatedKeys(fields = [], changedKeys = []) {
  const advertised = uniqueFields(fields)
  const changed = new Set(changedKeys)
  const resources = new Set(advertised.filter(field => changed.has(field.key)).map(resourceId))
  if (resources.has('setup')) return advertised.map(field => field.key)
  let grew = true
  while (grew) {
    grew = false
    for (const field of advertised) {
      if ((resources.has(resourceId(field)) || changed.has(field.visible_when?.key)) && !changed.has(field.key)) {
        changed.add(field.key)
        grew = true
      }
    }
  }
  return [...changed]
}

// This fingerprint is only navigation context. It deliberately excludes app
// options, endpoints, credentials and the newly generated plan identity.
export function setupGuidanceSelectionSignature({ coreServices = [], optionalServices = [], guidedWorkflowIntent = null, services = [] } = {}) {
  const selections = entries => entries.map(entry => ({
    key: typeof entry === 'string' ? entry : entry?.name || entry?.key || '',
    instance: typeof entry === 'string' ? '' : entry?.instance_name || entry?.instance_key || '',
  })).filter(entry => entry.key).sort((left, right) => left.key.localeCompare(right.key) || left.instance.localeCompare(right.instance))
  const intent = guidedWorkflowIntent || {}
  return JSON.stringify({
    core: selections(coreServices),
    optional: selections(optionalServices),
    intent: {
      mediaServer: intent.mediaServer || null,
      stack: intent.stack || null,
      usenetClient: intent.usenetClient || null,
      usenetCoreServices: [...new Set(intent.usenetCoreServices || [])].sort(),
    },
    resources: [...new Set(services.map(service => service.id || service.resource_id || service.service_key).filter(Boolean))].sort(),
  })
}
