import { setupActionMatchesService } from './setupArrangements.js'

export const SETUP_WALKTHROUGH_STORAGE_KEY = 'dumb.setup.walkthrough.v1'

export function setupWalkthroughInstructions(action = {}) {
  const authored = Array.isArray(action.instructions) ? action.instructions
    : typeof action.instructions === 'string' ? action.instructions.split(/\r?\n/) : []
  const normalize = value => value.trim().replace(/\s+/g, ' ')
  const seen = new Set(typeof action.reason === 'string' ? [normalize(action.reason)] : [])
  return authored.filter(value => typeof value === 'string').map(value => value.trim()).filter(value => {
    const key = normalize(value)
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function setupWalkthroughOutcome(action = {}) {
  const execution = action.execution || 'pending'
  const manual = action.evidence?.level === 'user_attested' || execution === 'user_confirmed'
  const notApplicable = execution === 'not_applicable'
  const verified = !manual && action.verification === 'passed'
    && ['applied', 'already_present', 'passed'].includes(execution)
  if (execution === 'failed' || action.verification === 'failed') return { state: 'failed', label: manual ? 'A check failed after your manual confirmation' : 'Needs attention', complete: false, resolved: false, verified: false, manual }
  if (notApplicable) return { state: 'not_required', label: 'Not needed for this setup', complete: true, resolved: true, verified: false, manual: false }
  if (verified) return { state: 'verified', label: 'Checked successfully', complete: true, resolved: true, verified: true, manual: false }
  if (manual) return { state: 'manual', label: 'Confirmed by you; not automatically checked', complete: false, resolved: true, verified: false, manual: true }
  if (action.deferred_by_user === true || execution === 'declined') return { state: 'deferred', label: 'Left for later', complete: false, resolved: false, verified: false, manual: false }
  if (execution === 'running') return { state: 'running', label: 'DUMB is working on this step', complete: false, resolved: false, verified: false, manual: false }
  if (execution === 'waiting_dependency') return { state: 'waiting', label: 'Waiting for another app or setup step', complete: false, resolved: false, verified: false, manual: false }
  if (['applied', 'already_present'].includes(execution)) return { state: 'unchecked', label: 'Configuration saved; connection not verified', complete: false, resolved: false, verified: false, manual: false }
  return { state: 'input', label: 'Ready for your review', complete: false, resolved: false, verified: false, manual: false }
}

const prerequisiteId = value => typeof value === 'string' ? value : value?.id

export function setupWalkthroughActions(run = {}, { serviceKey = '', instanceKey = '', includeOptionalChecks = false } = {}) {
  const actions = (run.actions || []).filter(action => action?.id && action.internal !== true)
  const remaining = new Map(actions.map((action, index) => [action.id, { action, index }]))
  const ordered = []
  while (remaining.size) {
    const ready = [...remaining.values()].filter(({ action }) => (action.prerequisites || []).every(value => !remaining.has(prerequisiteId(value))))
    const next = (ready.length ? ready : [...remaining.values()]).sort((left, right) => left.index - right.index)[0]
    ordered.push(next.action)
    remaining.delete(next.action.id)
  }
  return ordered.filter(action => setupActionMatchesService(action, serviceKey, instanceKey)
    && (includeOptionalChecks || action.explicit_only !== true))
}

export function setupWalkthroughPrerequisites(action = {}, run = {}) {
  const actions = new Map((run.actions || []).map(item => [item.id, item]))
  return (action.prerequisites || []).map(value => {
    const id = prerequisiteId(value)
    const prerequisite = actions.get(id)
    const outcome = prerequisite ? setupWalkthroughOutcome(prerequisite) : null
    return {
      id,
      label: prerequisite?.label || 'Another setup step',
      known: Boolean(prerequisite),
      ready: outcome?.complete === true,
      status: outcome?.label || 'DUMB will check this prerequisite before applying changes',
    }
  })
}

export function setupWalkthroughSummary(run = {}, options = {}) {
  const actions = setupWalkthroughActions(run, options)
  const outcomes = actions.map(action => ({ action, outcome: setupWalkthroughOutcome(action) }))
  return {
    total: actions.length,
    verified: outcomes.filter(item => item.outcome.verified).length,
    notRequired: outcomes.filter(item => item.outcome.state === 'not_required').length,
    manual: outcomes.filter(item => item.outcome.state === 'manual').length,
    confirmations: outcomes.filter(item => item.outcome.state === 'manual'),
    deferred: outcomes.filter(item => item.outcome.state === 'deferred').length,
    remaining: outcomes.filter(item => !item.outcome.resolved),
    requiredRemaining: outcomes.filter(item => item.action.required === true && !item.outcome.resolved).length,
  }
}

export function setupWalkthroughPreference(value, run = {}) {
  const runId = typeof run.run_id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(run.run_id) ? run.run_id : null
  const sameRun = value?.runId === runId
  const active = typeof value?.activeActionId === 'string' && value.activeActionId.length <= 512
    && (run.actions || []).some(action => action.id === value.activeActionId) ? value.activeActionId : null
  return {
    runId,
    activeActionId: sameRun ? active : null,
    paused: sameRun && value?.paused === true,
    includeOptionalChecks: sameRun && value?.includeOptionalChecks === true,
  }
}

export function readSetupWalkthroughPreference(storage, run) {
  try { return setupWalkthroughPreference(JSON.parse(storage?.getItem(SETUP_WALKTHROUGH_STORAGE_KEY) || 'null'), run) }
  catch { return setupWalkthroughPreference(null, run) }
}

export function writeSetupWalkthroughPreference(storage, run, value) {
  const preference = setupWalkthroughPreference(value, run)
  try { if (preference.runId) storage?.setItem(SETUP_WALKTHROUGH_STORAGE_KEY, JSON.stringify(preference)) } catch { /* Navigation still works without browser storage. */ }
  return preference
}
