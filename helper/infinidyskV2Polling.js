import { isInfiniDyskV2JobActive } from './infinidyskV2.js'
import { infinidyskV2PreviewBlocked } from './infinidyskV2Preview.js'
import { infinidyskV2PostgresRequestPending } from './infinidyskV2Status.js'

// One read-only loop is shared by the notice and both dialogs. No mutation is
// retried here; lifecycle owners only request fresh durable observations.
export const createInfiniDyskV2Polling = ({ refresh, getState, page = null, windowTarget = null, setTimer = setTimeout, clearTimer = clearTimeout }) => {
  const owners = new Map()
  let timer = null, generation = 0, flight = null, wakeQueued = false
  const visible = () => page?.visibilityState !== 'hidden'
  const clear = () => { if (timer !== null) clearTimer(timer); timer = null }
  const interval = () => {
    const state = getState()
    return [...owners.values()].some(owner => owner.active) || state.busy || isInfiniDyskV2JobActive(state.majorJob)
      || isInfiniDyskV2JobActive(state.postgresJob) || infinidyskV2PostgresRequestPending(state.postgresMutation) || infinidyskV2PreviewBlocked(state) ? 2000 : 15000
  }
  const poll = async current => {
    if (current !== generation || !owners.size || !visible()) return
    if (flight) { wakeQueued = true; return flight }
    const operation = (async () => {
      try { await refresh({ force: true, ...([...owners.values()].some(owner => owner.postgresOnly) ? { postgresOnly: true } : {}) }) } catch { /* The controller retains unconfirmed state. */ }
    })()
    flight = operation
    await operation
    if (flight === operation) flight = null
    if (current !== generation || !owners.size || !visible()) return
    const delay = wakeQueued ? 0 : interval()
    wakeQueued = false
    timer = setTimer(() => { timer = null; poll(current) }, delay)
  }
  const wake = () => { clear(); if (owners.size && visible()) poll(generation) }
  const visibility = () => { clear(); if (visible()) wake() }
  const subscribe = ({ active = false, postgresOnly = false } = {}) => {
    const token = Symbol('migration-status-owner')
    owners.set(token, { active, postgresOnly })
    if (owners.size === 1) {
      page?.addEventListener?.('visibilitychange', visibility)
      windowTarget?.addEventListener?.('focus', wake)
    }
    wake()
    return () => {
      owners.delete(token)
      if (!owners.size) {
        generation++; clear(); flight = null; wakeQueued = false
        page?.removeEventListener?.('visibilitychange', visibility)
        windowTarget?.removeEventListener?.('focus', wake)
      }
    }
  }
  return { subscribe, wake }
}
