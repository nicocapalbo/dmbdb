import { infinidyskV2ActivateReady, infinidyskV2PreparedActivationSupported } from './infinidyskV2Prepared.js'
import { infinidyskV2StageRetry, infinidyskV2StageRetryReady, infinidyskV2StageRetrySupported } from './infinidyskV2StageRetry.js'
import { infinidyskV2AmbiguousRequest, infinidyskV2MutationObserved, infinidyskV2PostgresRequestPending } from './infinidyskV2Status.js'
import { createInfiniDyskV2PreviewController, initialInfiniDyskV2PreviewState, infinidyskV2AsyncPreviewSupported, infinidyskV2PreviewBlocked, infinidyskV2ClientError } from './infinidyskV2Preview.js'
import {
  infinidyskV2CancelReady, infinidyskV2ConsumerActionReady, infinidyskV2RollbackReady, infinidyskV2ImportReport, infinidyskV2CleanupSupported, infinidyskV2ErrorText, infinidyskV2Support, infinidyskV2PostgresPreparationSupported, infinidyskV2ActionAllowed, infinidyskV2NeedsAttention, isInfiniDyskV2CleanupActive, isInfiniDyskV2JobActive, normalizeInfiniDyskV2Job,
} from './infinidyskV2.js'

export const initialInfiniDyskV2State = () => ({
  capabilities: null, resolved: false, major: null, postgres: null,
  majorJob: null, postgresJob: null, busy: false, error: '',
  majorStatusConfirmed: false, postgresStatusConfirmed: false,
  postgresError: '',
  majorObservedAt: null, postgresObservedAt: null, refreshing: false, majorMutation: null, postgresMutation: null,
  majorOpen: false, postgresOpen: false, majorRequestedMountBackend: null,
  ...initialInfiniDyskV2PreviewState(),
})

const storageKey = 'dumb.infinidyskV2.jobs.v1'

// Only opaque job/request identities survive reload; tokens and credentials do not.
export const createInfiniDyskV2Controller = ({ state, repository, storage = null }) => {
  let refreshing = null
  let postgresRefreshing = null
  let generation = 0
  let requestSequence = 0
  const observations = { major: 0, postgres: 0 }
  const update = changes => { state.value = { ...state.value, ...changes } }
  const preview = createInfiniDyskV2PreviewController({ state, repository, generation: () => generation })
  const remembered = () => {
    try {
      const value = JSON.parse(storage?.getItem(storageKey) || '{}')
      const jobs = Object.fromEntries(['major', 'postgres'].map(key => [key,
        typeof value?.[key] === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(value[key]) ? value[key] : null,
      ]))
      const request = value?.postgres_request
      if (request && typeof request.request_id === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(request.request_id)
        && (request.preview_id === null || typeof request.preview_id === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(request.preview_id))
        && (request.previous_job_id === null || typeof request.previous_job_id === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(request.previous_job_id))) jobs.postgresRequest = {
          request_id: request.request_id, preview_id: request.preview_id, previous_job_id: request.previous_job_id,
          kind: 'postgres', action: 'postgresStart', status: 'uncertain', job_id: null, error: '',
        }
      return jobs
    } catch { return {} }
  }
  const remember = () => {
    try {
      const prior = remembered()
      storage?.setItem(storageKey, JSON.stringify({
        major: state.value.majorJob?.job_id || prior.major || null,
        postgres: state.value.postgresJob?.job_id || prior.postgres || null,
        ...(infinidyskV2PostgresRequestPending(state.value.postgresMutation) ? { postgres_request: {
          request_id: state.value.postgresMutation.request_id, preview_id: state.value.postgresMutation.preview_id,
          previous_job_id: state.value.postgresMutation.previous_job_id,
        } } : {}),
      }))
    } catch { /* Storage denial must not interrupt a backend job. */ }
  }
  const observeMutation = (kind, job) => {
    const field = kind + 'Mutation', request = state.value[field]
    if (infinidyskV2MutationObserved(request, job)) update({ [field]: { ...request, status: 'confirmed', job_id: job.job_id, error: '' } })
    else if (kind === 'postgres' && infinidyskV2PostgresRequestPending(request) && !request.preview_id
      && job && job.job_id !== request.previous_job_id && job.recovery_required !== true
      && ['cancelled', 'completed', 'rolled_back'].includes(job.status)) update({ [field]: { ...request, status: 'settled', job_id: job.job_id, error: '' } })
  }
  const refreshPostgres = () => {
    if (postgresRefreshing) return postgresRefreshing
    const currentGeneration = generation
    const prior = remembered()
    if (!state.value.postgresMutation && prior.postgresRequest) update({ postgresMutation: prior.postgresRequest })
    if (!state.value.postgresJob && prior.postgres) update({ postgresJob: {
      job_id: prior.postgres, status: 'unconfirmed', recovery_required: true,
      message: 'Saved job identity retained. Its backend state has not been confirmed; keep recovery evidence and refresh status.',
    } })
    let pending
    pending = (async () => {
      try {
        const response = await repository.postgresStatus()
        if (currentGeneration !== generation) return state.value
        if (response?.protocol !== 1) throw infinidyskV2ClientError('Unsupported database status protocol.')
        const job = normalizeInfiniDyskV2Job(response.job)
        observations.postgres++
        const oldError = state.value.postgresError
        update({ postgres: response, postgresJob: job || state.value.postgresJob, postgresStatusConfirmed: true, postgresObservedAt: Date.now(), postgresError: '',
          ...(oldError && state.value.error === oldError ? { error: '' } : {}),
        })
        observeMutation('postgres', job)
        remember()
      } catch (error) {
        if (currentGeneration === generation) update({ postgresStatusConfirmed: false, postgresError: infinidyskV2ErrorText(error) })
      }
      return state.value
    })().finally(() => { if (postgresRefreshing === pending) postgresRefreshing = null })
    postgresRefreshing = pending
    return pending
  }
  const refreshAll = ({ force = false } = {}) => {
    if (refreshing) return refreshing
    if (state.value.busy && !force) return Promise.resolve(state.value)
    const currentGeneration = generation
    update({ refreshing: true })
    let pending
    pending = (async () => {
      let capabilities = null
      try { capabilities = await repository.capabilities() } catch { /* Fail closed for mutations. */ }
      if (currentGeneration !== generation) return state.value
      update({ capabilities })
      const support = infinidyskV2Support(capabilities)
      const prior = remembered()
      const restored = {}
      if (!state.value.postgresMutation && prior.postgresRequest) restored.postgresMutation = prior.postgresRequest
      for (const kind of ['major', 'postgres']) {
        const field = kind + 'Job'
        if (!state.value[field] && prior[kind]) restored[field] = {
          job_id: prior[kind], status: 'unconfirmed', recovery_required: true,
          message: 'Saved job identity retained. Its backend state has not been confirmed; keep recovery evidence and refresh status.',
        }
      }
      if (Object.keys(restored).length) update(restored)
      const errors = []
      let postgresError = ''
      const readMajor = async () => {
        if (!(support.migration || state.value.majorJob || prior.major)) return
        try {
          const response = await repository.status()
          if (currentGeneration !== generation) return state.value
          if (response?.protocol !== 1) throw infinidyskV2ClientError('Unsupported migration status protocol.')
          let job = normalizeInfiniDyskV2Job(response.job)
          if (!job && (state.value.majorJob?.job_id || prior.major)) job = normalizeInfiniDyskV2Job(await repository.job(state.value.majorJob?.job_id || prior.major))
          if (currentGeneration !== generation) return state.value
          observations.major++
          update({ major: response, majorJob: job || state.value.majorJob, majorStatusConfirmed: true, majorObservedAt: Date.now() })
          observeMutation('major', job)
          if (infinidyskV2AsyncPreviewSupported(capabilities) && Object.hasOwn(response, 'preview_task')) {
            try { preview.observeMajorPreview(response.preview_task) }
            catch (error) { update({ majorPreviewConfirmed: false, majorPreviewUncertain: true, majorPreviewError: infinidyskV2ErrorText(error) }) }
          }
        } catch (error) {
          if (currentGeneration !== generation) return state.value
          update({ majorStatusConfirmed: false }); errors.push(infinidyskV2ErrorText(error))
        }
      }
      const readPostgres = async () => {
        // Discover an admitted database job even on a fresh page or while the
        // independent major-workflow endpoint is slow/unavailable.
        if (!(support.postgres && state.value.major?.runtime_generation !== '1') && !state.value.postgresJob && !prior.postgres && !prior.postgresRequest && !state.value.postgresMutation) return
        try {
          await refreshPostgres()
          if (currentGeneration !== generation) return state.value
          postgresError = state.value.postgresError
        } catch (error) {
          if (currentGeneration !== generation) return state.value
          update({ postgresStatusConfirmed: false }); postgresError = infinidyskV2ErrorText(error)
        }
      }
      await Promise.allSettled([readMajor(), readPostgres()])
      if (currentGeneration !== generation) return state.value
      if (postgresError && (state.value.major?.runtime_generation !== '1' || state.value.postgresJob || state.value.postgresMutation || prior.postgres)) errors.push(postgresError)
      update({ resolved: true, error: errors.join(' ') })
      if (state.value.majorJob || state.value.postgresJob || state.value.postgresMutation) remember()
      return state.value
    })().finally(() => {
      if (refreshing === pending) {
        refreshing = null
        if (currentGeneration === generation) update({ refreshing: false })
      }
    })
    refreshing = pending
    return pending
  }
  const refresh = (options = {}) => {
    const full = refreshAll(options)
    // A database-panel owner keeps its own bounded GET flight. The major
    // workflow can finish in the background without delaying database reads.
    return options.postgresOnly ? refreshPostgres() : full
  }

  const mutate = async (kind, action, payload, context = {}) => {
    const admittedGeneration = generation
    if (state.value.busy) throw infinidyskV2ClientError('An InfiniDysk request is already in progress.')
    if (refreshing) await refreshing
    if (admittedGeneration !== generation) throw infinidyskV2ClientError('The session changed. Refresh status before requesting another operation.')
    if (state.value.busy) throw infinidyskV2ClientError('An InfiniDysk request is already in progress.')
    const support = infinidyskV2Support(state.value.capabilities)
    if (kind === 'postgres' && action === 'postgresStart' && infinidyskV2PostgresRequestPending(state.value.postgresMutation)) throw infinidyskV2ClientError('The previous database start request is still unconfirmed. Refresh status; do not start another copy.')
    if (kind === 'postgres' && isInfiniDyskV2CleanupActive(state.value.majorJob)) throw infinidyskV2ClientError('Old-installation cleanup is still running.')
    if (kind === 'postgres' && isInfiniDyskV2JobActive(state.value.majorJob)) throw infinidyskV2ClientError('Resolve the major migration or its service recovery before changing the database provider.')
    if (action === 'postgresPrepareTarget' && (kind !== 'postgres' || !infinidyskV2PostgresPreparationSupported(state.value.capabilities)
      || state.value.major?.runtime_generation !== '2' || state.value.postgres?.provider !== 'sqlite'
      || !infinidyskV2ActionAllowed(state.value.postgres, 'start') || infinidyskV2NeedsAttention(state.value.postgresJob)
      || payload?.target?.use_managed_postgres !== true || typeof payload.target.database !== 'string' || !payload.target.database.trim())) throw infinidyskV2ClientError('Refresh the database state and managed preparation support before preparing a destination.')
    if (['cleanupPreview', 'cleanup'].includes(action) && (kind !== 'major' || !infinidyskV2CleanupSupported(state.value.capabilities))) throw infinidyskV2ClientError('This backend does not advertise guarded cleanup.')
    if (action === 'prepare' && (kind !== 'major' || !infinidyskV2PreparedActivationSupported(state.value.capabilities) || isInfiniDyskV2JobActive(state.value.majorJob))) throw infinidyskV2ClientError('Refresh the current migration state and prepare capability before starting a new preparation.')
    if (action === 'activate' && infinidyskV2ImportReport(state.value.majorJob?.import_report)?.review_required === true && payload?.skip_review_digest !== state.value.majorJob.import_report.review_digest) throw infinidyskV2ClientError('The skipped-item review no longer matches this candidate. Review its current report again.')
    if (action === 'activate' && (kind !== 'major' || payload?.job_id !== state.value.majorJob?.job_id || !infinidyskV2ActivateReady({ capabilities: state.value.capabilities, confirmed: state.value.majorStatusConfirmed, busy: state.value.busy, job: state.value.majorJob, confirmation: payload?.confirmation, acknowledgeSkippedMedia: payload?.acknowledgements?.skipped_media }))) throw infinidyskV2ClientError('Refresh the exact prepared candidate and review its import report before activation.')
    if (action === 'retryStage' && (kind !== 'major' || payload?.job_id !== state.value.majorJob?.job_id || !infinidyskV2StageRetryReady({ capabilities: state.value.capabilities, confirmed: state.value.majorStatusConfirmed, busy: state.value.busy, job: state.value.majorJob, confirmation: payload?.confirmation }))) throw infinidyskV2ClientError('Refresh the exact paused migration step and its current retry authorization before retrying.')
    if (kind === 'major' && action === 'cancel' && (payload?.job_id !== state.value.majorJob?.job_id || !infinidyskV2CancelReady({ capabilities: state.value.capabilities, confirmed: state.value.majorStatusConfirmed, busy: state.value.busy, job: state.value.majorJob, confirmation: payload?.confirmation }))) throw infinidyskV2ClientError('Refresh the exact migration job and its guarded cancellation authorization before retrying.')
    if (['retryConsumers', 'finishConsumerRecovery'].includes(action) && (kind !== 'major' || payload?.job_id !== state.value.majorJob?.job_id || !infinidyskV2ConsumerActionReady({ capabilities: state.value.capabilities, confirmed: state.value.majorStatusConfirmed, busy: state.value.busy, job: state.value.majorJob, action: action === 'retryConsumers' ? 'retry_consumers' : 'finish_consumer_recovery', confirmation: payload?.confirmation, acknowledgePendingConsumers: payload?.acknowledge_pending_consumers }))) throw infinidyskV2ClientError('Refresh the exact migration job and its guarded v2 service recovery authorization before retrying.')
    if (kind === 'major' && action === 'rollback' && (payload?.job_id !== state.value.majorJob?.job_id || !infinidyskV2RollbackReady({ capabilities: state.value.capabilities, confirmed: state.value.majorStatusConfirmed, busy: state.value.busy, job: state.value.majorJob, confirmation: payload?.confirmation, confirmationText: state.value.major?.rollback_confirmation_text, acknowledgeDiscardV2Writes: payload?.acknowledge_discard_v2_writes }))) throw infinidyskV2ClientError('Refresh the exact retained migration job and acknowledge any required loss of v2 writes before rollback.')
    if (!(kind === 'major' ? support.migration : support.postgres)) throw infinidyskV2ClientError('This backend does not advertise the required InfiniDysk 2 protocol.')
    if (!state.value[kind === 'major' ? 'majorStatusConfirmed' : 'postgresStatusConfirmed']) throw infinidyskV2ClientError('Refresh the current backend job state before changing it.')
    if (['preview', 'rehearse', 'start', 'prepare', 'activate', 'postgresPrepareTarget', 'postgresPreview', 'postgresStart', 'postgresCutover', 'cleanupPreview', 'cleanup'].includes(action) && infinidyskV2PreviewBlocked(state.value)) throw infinidyskV2ClientError('A migration preview is still running or unconfirmed. Check preview status before changing the installation.')
    const currentGeneration = generation
    const field = kind + 'Mutation'
    const request = {
      request_id: String(currentGeneration) + '-' + String(++requestSequence), kind, action, status: 'pending',
      previous_job_id: state.value[kind + 'Job']?.job_id || null,
      plan_fingerprint: typeof context.plan_fingerprint === 'string' ? context.plan_fingerprint : null,
      ...(action === 'postgresStart' ? { preview_id: typeof context.preview_id === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(context.preview_id) ? context.preview_id : null } : {}),
      started_at: Date.now(), job_id: null, error: '',
      ...(action === 'retryStage' ? { retry_stage_attempt: infinidyskV2StageRetry(state.value.majorJob).attempt, retry_stage_operation: state.value.majorJob.stage_retry.operation } : {}),
    }
    const observedBefore = observations[kind]
    update({ busy: true, error: '', [field]: request })
    if (action === 'postgresStart') remember()
    let reconciled = false
    const reconcile = async () => {
      // A read started before the response cannot settle its outcome. Finish
      // that read, then obtain fresh durable status without replaying the POST.
      if (refreshing) await refreshing
      if (currentGeneration === generation) await refresh({ force: true })
      reconciled = true
    }
    try {
      const requestPayload = { ...payload }
      if (kind === 'major' && ['prepare', 'rehearse', 'start'].includes(action)) {
        delete requestPayload.pause_on_stage_error
        if (infinidyskV2StageRetrySupported(state.value.capabilities)) requestPayload.pause_on_stage_error = true
      }
      const response = await repository[action](requestPayload)
      if (currentGeneration !== generation) return response
      const job = normalizeInfiniDyskV2Job(response)
      if (job) {
        const observed = state.value[kind + 'Job']
        if (observations[kind] === observedBefore || !observed
          || (job.job_id !== request.previous_job_id && observed.job_id === request.previous_job_id)) update({ [kind + 'Job']: job })
        update({ [field]: { ...request, status: 'confirmed', job_id: job.job_id } })
        remember()
      }
      return response
    } catch (error) {
      if (currentGeneration !== generation) throw error
      await reconcile()
      if (currentGeneration !== generation) throw error
      const latest = state.value[kind + 'Job']
      if (infinidyskV2AmbiguousRequest(error) && infinidyskV2MutationObserved(state.value[field], latest)) {
        update({ [field]: { ...request, status: 'confirmed', job_id: latest.job_id, error: '' } })
        return { job: latest, reconciled: true }
      }
      update({ [field]: { ...request, status: infinidyskV2AmbiguousRequest(error) ? 'uncertain' : 'rejected', error: infinidyskV2ErrorText(error) } })
      throw error
    } finally {
      if (currentGeneration === generation) {
        if (!reconciled) await reconcile()
        if (currentGeneration === generation) { update({ busy: false }); remember() }
      }
    }
  }

  const reset = () => {
    generation++
    refreshing = null
    postgresRefreshing = null
    try { storage?.removeItem(storageKey) } catch { /* Optional storage. */ }
    state.value = initialInfiniDyskV2State()
  }
  const prepareMajorPreview = async (options, settings) => {
    if (refreshing) await refreshing
    return preview.prepareMajorPreview(options, settings)
  }
  return { refresh, mutate, update, reset, sessionGeneration: () => generation, ...preview, prepareMajorPreview }
}
