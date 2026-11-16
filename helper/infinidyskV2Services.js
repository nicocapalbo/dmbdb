import { isInfiniDyskV2JobActive } from './infinidyskV2.js'

export const infinidyskV2AffectedServices = job => {
  const value = job?.affected_services
  return Array.isArray(value) && value.length <= 256
    && value.every(name => typeof name === 'string' && name.trim().length > 0 && name.length <= 160 && !/\p{C}|\p{Zl}|\p{Zp}/u.test(name))
    ? [...new Set(value)] : []
}
const unknown = snapshot => ({ ...snapshot, status: 'unknown', healthy: null, health_status: null,
  health_reason: null, health_details: null, restart: null })

// Unknown is a freshness state, never an assumption that an app was stopped.
export const createInfiniDyskV2ServiceObserver = ({ getSnapshot, setSnapshot, fetchStatus }) => {
  let generation = 0, scopeKey = null, flight = null, previous = null
  const reset = () => { generation++; scopeKey = null; flight = null; previous = null }
  const observe = async (job, { confirmed = true } = {}) => {
    if (previous && job?.job_id !== previous.job_id) reset()
    const names = infinidyskV2AffectedServices(job)
    const active = isInfiniDyskV2JobActive(job)
    if (!confirmed) {
      generation++; flight = null
      for (const name of previous?.names || []) setSnapshot(name, unknown(getSnapshot(name)))
      if (previous) previous.needs_terminal_refresh = true
      return
    }
    if (!names.length || (!active && (!previous || (!previous.active && !previous.needs_terminal_refresh)))) return
    const key = JSON.stringify([job.job_id, job.status, job.stage, names])
    if (key !== scopeKey) {
      generation++; scopeKey = key; flight = null
      for (const name of names) setSnapshot(name, unknown(getSnapshot(name)))
    }
    previous = { job_id: job.job_id, names, active, needs_terminal_refresh: !active }
    if (flight) return flight
    const current = generation
    let cursor = 0, succeeded = true
    const operation = Promise.all(Array.from({ length: Math.min(4, names.length) }, async () => {
      while (cursor < names.length) {
        if (current !== generation) return
        const name = names[cursor++]
        try {
          const result = await fetchStatus(name)
          if (current !== generation) return
          if (result?.process_name !== name || !['running', 'stopped', 'unknown'].includes(result?.status)) throw new Error('Unconfirmed service status')
          if (result.status === 'unknown') succeeded = false
          setSnapshot(name, { ...result, status: result.status })
        } catch {
          if (current !== generation) return
          succeeded = false
          if (current === generation) setSnapshot(name, unknown(getSnapshot(name)))
        }
      }
    }))
    flight = operation
    await operation
    if (flight === operation) flight = null
    if (current === generation && !active && succeeded && previous?.job_id === job.job_id) previous.needs_terminal_refresh = false
  }
  return { observe, reset }
}
