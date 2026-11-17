import { infinidyskV2Support } from './infinidyskV2.js'

export const infinidyskV2QueueOmissionCapability = capabilities => infinidyskV2Support(capabilities).migration
  && capabilities?.infinidysk_v2_queue_omission === true
export const infinidyskV2QueueOmissionSupported = (capabilities, status) => infinidyskV2QueueOmissionCapability(capabilities)
  && status?.mode === 'migrate' && status?.runtime_generation === '1'
export const infinidyskV2QueueFields = (capabilities, status, selected) => infinidyskV2QueueOmissionSupported(capabilities, status)
  && selected === true ? { omit_queued_downloads: true } : {}

const count = value => Number.isSafeInteger(value) && value >= 0
export const infinidyskV2SourceQueue = value => {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || !['require_empty', 'omit_from_v2'].includes(value.policy)
    || !['live', 'unavailable', 'captured'].includes(value.observation)
    || value.source_queue_preserved !== true
    || !['observed_count', 'observed_at', 'omitted_count'].every(key => value[key] === null || count(value[key]))) return null
  return { policy: value.policy, observation: value.observation, observedCount: value.observed_count,
    observedAt: value.observed_at, omittedCount: value.omitted_count }
}
export const infinidyskV2SourceQueueMatches = (preview, selected = false) => {
  if (typeof selected !== 'boolean') return false
  if (preview?.source_queue === undefined) return !selected
  const queue = infinidyskV2SourceQueue(preview.source_queue)
  return Boolean(queue && queue.policy === (selected ? 'omit_from_v2' : 'require_empty'))
}
