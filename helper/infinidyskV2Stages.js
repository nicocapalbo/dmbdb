import { infinidyskV2JobLabel } from './infinidyskV2Presentation.js'

const stages = {
  check_plan: ['Check the migration plan', 'Check the source, available space and selected migration options.'],
  pause_services: ['Pause v1 and affected apps', 'Stop managed apps that could change or use the library during migration.'],
  source_database: ['Prepare the v1 database', 'Capture the PostgreSQL source and verify that its recovery backup can be restored.'],
  save_recovery: ['Save and verify recovery data', 'Keep a verified copy of v1 before changing its working files.'],
  prepare_input: ['Prepare files for conversion', 'Prepare the selected local or external working copy and check it before import.'],
  native_import: ['Convert with InfiniDysk 2', 'Run the real InfiniDysk importer. Provider reads and recovery of old file information can take time.'],
  validate_import: ['Check the converted library', 'Check the imported database, library inventory and native import report.'],
  review: ['Review the prepared result', 'Your decision is required. Activate this same candidate or restore v1; affected apps stay stopped.'],
  activate: ['Activate InfiniDysk 2', 'Select the converted candidate and verify the application and library mount.'],
  resume_services: ['Resume affected apps', 'Resume the retained services and check their results.'],
  restore_v1: ['Restore and check v1', 'Restore the retained v1 state and affected services, then verify recovery.'],
  cleanup_test: ['Finish the test', 'Finish the test and retain its result after restoring v1.'],
}
const states = {
  pending: { label: 'Queued', symbol: '○' },
  running: { label: 'In progress', symbol: '●' },
  completed: { label: 'Completed', symbol: '✓' },
  failed: { label: 'Failed', symbol: '!' },
  interrupted: { label: 'Interrupted', symbol: '!' },
  not_run: { label: 'Not run', symbol: '—' },
  waiting: { label: 'Waiting for your decision', symbol: '◇' },
}
const object = value => value && typeof value === 'object' && !Array.isArray(value)
const timestamp = value => typeof value === 'number' && Number.isFinite(value) && value >= 0

// Completion belongs to the saved backend journal, never to the position of a
// stage in a list, the last five events, or a browser's memory of earlier polls.
export const infinidyskV2Stages = (value, { job = null, confirmed = true, preview = false } = {}) => {
  const valid = object(value) && value.protocol === 1 && ['recorded', 'legacy'].includes(value.tracking)
    && Array.isArray(value.steps) && value.steps.length > 0 && value.steps.length <= 16
    && value.steps.every(step => object(step) && Object.hasOwn(stages, step.id) && Object.hasOwn(states, step.state))
    && new Set(value.steps.map(step => step.id)).size === value.steps.length
    && (value.current_step_id == null || value.steps.some(step => step.id === value.current_step_id))
  if (!valid || value.tracking === 'legacy') {
    if (preview) return null
    return {
      recorded: false, steps: [],
      note: 'Earlier stage completion was not recorded for this run. The current phase and retained result remain available.',
      currentLabel: typeof job?.stage === 'string' ? infinidyskV2JobLabel(job.stage, job.mode) : null,
    }
  }
  const fresh = job?.mode === 'fresh' || (job?.mode === 'prepare' && job?.prepare_mode === 'fresh')
  const retryDecision = job?.status === 'stage_retry_required'
  const recordedNote = retryDecision
    ? job.cancel_requested === true
      ? 'Restoration has been requested. Stage results will update when the worker starts restoring ' + (fresh ? 'the previous setup' : 'v1') + '.'
      : 'Completed stages are retained. The current step is paused for your retry or restore decision.'
    : 'Stage results are saved by DUMB and update automatically. Stages take different amounts of time.'
  const rows = value.steps.map(step => {
    const [label, detail] = (fresh ? {
      pause_services: ['Pause affected apps', 'Stop managed apps that must remain paused during installation.'],
      save_recovery: ['Save the previous setup', 'Keep the configuration and recovery state needed to restore the previous setup.'],
      prepare_input: ['Prepare installation files', 'Prepare the selected working location and installation settings.'],
      native_import: ['Prepare InfiniDysk 2', 'Prepare the new InfiniDysk installation. There is no v1 library to convert.'],
      validate_import: ['Check the prepared installation', 'Check the new installation before it can be activated.'],
      review: ['Review the prepared result', 'Your decision is required. Activate this candidate or restore the previous setup; affected apps stay stopped.'],
      restore_v1: ['Restore the previous setup', 'Restore and check the saved configuration and affected services.'],
    }[step.id] : null) || stages[step.id]
    const result = { id: step.id, state: step.state, label, detail,
      statusLabel: states[step.state].label, symbol: states[step.state].symbol }
    if (retryDecision && step.id === value.current_step_id && ['failed', 'waiting'].includes(step.state)) result.statusLabel = job.cancel_requested === true ? 'Restoration requested' : 'Paused — decision required'
    if (!confirmed && ['running', 'waiting'].includes(step.state)) result.statusLabel = 'Last confirmed: ' + result.statusLabel.toLowerCase()
    if (timestamp(step.started_at)) result.startedAt = step.started_at
    if (timestamp(step.completed_at) && timestamp(step.started_at) && step.completed_at >= step.started_at) {
      result.elapsedSeconds = step.completed_at - step.started_at
    }
    return result
  })
  return {
    recorded: true, steps: rows,
    recovery: job?.mode !== 'rehearsal' && rows.some(step => step.id === 'restore_v1'),
    currentId: value.current_step_id || null,
    note: preview ? 'These are the stages planned for these options. The live list updates as DUMB records the work.'
      : confirmed ? recordedNote
        : 'These are the last confirmed stage results. Reconnecting before reporting further progress.',
  }
}
