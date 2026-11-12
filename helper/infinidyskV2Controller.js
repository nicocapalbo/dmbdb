import {
  infinidyskV2CancelReady, infinidyskV2CleanupSupported, infinidyskV2ErrorText, infinidyskV2Support, isInfiniDyskV2CleanupActive, normalizeInfiniDyskV2Job,
} from './infinidyskV2.js'

export const initialInfiniDyskV2State = () => ({
  capabilities: null, resolved: false, major: null, postgres: null,
  majorJob: null, postgresJob: null, busy: false, error: '',
  majorStatusConfirmed: false, postgresStatusConfirmed: false,
  majorOpen: false, postgresOpen: false, majorRequestedMountBackend: null,
})

const storageKey = 'dumb.infinidyskV2.jobs.v1'

// Only opaque job identities survive reload; previews and credentials never do.
export const createInfiniDyskV2Controller = ({ state, repository, storage = null }) => {
  let refreshing = null
  let generation = 0
  const update = changes => { state.value = { ...state.value, ...changes } }
  const remembered = () => {
    try {
      const value = JSON.parse(storage?.getItem(storageKey) || '{}')
      return Object.fromEntries(['major', 'postgres'].map(key => [key,
        typeof value?.[key] === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(value[key]) ? value[key] : null,
      ]))
    } catch { return {} }
  }
  const remember = () => {
    try {
      storage?.setItem(storageKey, JSON.stringify({
        major: state.value.majorJob?.job_id || null,
        postgres: state.value.postgresJob?.job_id || null,
      }))
    } catch { /* Storage denial must not interrupt a backend job. */ }
  }
  const refresh = ({ force = false } = {}) => {
    if (refreshing) return refreshing
    if (state.value.busy && !force) return Promise.resolve(state.value)
    const currentGeneration = generation
    refreshing = (async () => {
      let capabilities = null
      try { capabilities = await repository.capabilities() } catch { /* Fail closed for mutations. */ }
      if (currentGeneration !== generation) return state.value
      update({ capabilities })
      const support = infinidyskV2Support(capabilities)
      const prior = remembered()
      const restored = {}
      for (const kind of ['major', 'postgres']) {
        const field = `${kind}Job`
        if (!state.value[field] && prior[kind]) restored[field] = {
          job_id: prior[kind], status: 'unconfirmed', recovery_required: true,
          message: 'Saved job identity retained. Its backend state has not been confirmed; keep recovery evidence and refresh status.',
        }
      }
      if (Object.keys(restored).length) update(restored)
      const errors = []
      if (support.migration || state.value.majorJob || prior.major) {
        try {
          const response = await repository.status()
          if (currentGeneration !== generation) return state.value
          if (response?.protocol !== 1) throw new Error('Unsupported migration status protocol.')
          let job = normalizeInfiniDyskV2Job(response.job)
          if (!job && (state.value.majorJob?.job_id || prior.major)) {
            job = normalizeInfiniDyskV2Job(await repository.job(state.value.majorJob?.job_id || prior.major))
          }
          if (currentGeneration !== generation) return state.value
          update({ major: response, majorJob: job || state.value.majorJob, majorStatusConfirmed: true })
        } catch (error) { update({ majorStatusConfirmed: false }); errors.push(infinidyskV2ErrorText(error)) }
      }
      if ((support.postgres && state.value.major?.runtime_generation === '2') || state.value.postgresJob || prior.postgres) {
        try {
          const response = await repository.postgresStatus()
          if (currentGeneration !== generation) return state.value
          if (response?.protocol !== 1) throw new Error('Unsupported database status protocol.')
          const job = normalizeInfiniDyskV2Job(response.job)
          update({ postgres: response, postgresJob: job || state.value.postgresJob, postgresStatusConfirmed: true })
          // The native status endpoint owns resumption of its durable worker;
          // a missing remembered job is never interpreted as successful recovery.
          if (!job && prior.postgres && !state.value.postgresJob) errors.push('A saved database job could not be confirmed. Keep its recovery evidence and refresh status.')
        } catch (error) { update({ postgresStatusConfirmed: false }); errors.push(infinidyskV2ErrorText(error)) }
      }
      if (currentGeneration !== generation) return state.value
      update({ resolved: true, error: errors.join(' ') })
      if (state.value.majorJob || state.value.postgresJob) remember()
      return state.value
    })().finally(() => { refreshing = null })
    return refreshing
  }

  const mutate = async (kind, action, payload) => {
    if (state.value.busy) throw new Error('An InfiniDysk request is already in progress.')
    if (refreshing) await refreshing
    if (state.value.busy) throw new Error('An InfiniDysk request is already in progress.')
    const support = infinidyskV2Support(state.value.capabilities)
    if (kind === 'postgres' && isInfiniDyskV2CleanupActive(state.value.majorJob)) throw new Error('Old-installation cleanup is still running.')
    if (['cleanupPreview', 'cleanup'].includes(action) && (kind !== 'major' || !infinidyskV2CleanupSupported(state.value.capabilities))) throw new Error('This backend does not advertise guarded cleanup.')
    if (kind === 'major' && action === 'cancel' && (payload?.job_id !== state.value.majorJob?.job_id || !infinidyskV2CancelReady({ capabilities: state.value.capabilities, confirmed: state.value.majorStatusConfirmed, busy: state.value.busy, job: state.value.majorJob, confirmation: payload?.confirmation }))) throw new Error('Refresh the exact migration job and its guarded cancellation authorization before retrying.')
    if (!(kind === 'major' ? support.migration : support.postgres)) throw new Error('This backend does not advertise the required InfiniDysk 2 protocol.')
    if (!state.value[kind === 'major' ? 'majorStatusConfirmed' : 'postgresStatusConfirmed']) throw new Error('Refresh the current backend job state before changing it.')
    const currentGeneration = generation
    update({ busy: true, error: '' })
    try {
      const response = await repository[action](payload)
      if (currentGeneration !== generation) return response
      const job = normalizeInfiniDyskV2Job(response)
      if (job) { update({ [kind === 'major' ? 'majorJob' : 'postgresJob']: job }); remember() }
      return response
    } finally {
      // A timed-out POST may have started a job. Reconcile instead of replaying.
      if (currentGeneration === generation) {
        await refresh({ force: true })
        update({ busy: false })
      }
    }
  }
  const reset = () => {
    generation++
    try { storage?.removeItem(storageKey) } catch { /* Optional storage. */ }
    state.value = initialInfiniDyskV2State()
  }
  return { refresh, mutate, update, reset }
}
