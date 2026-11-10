import { infinidyskV2Support } from './infinidyskV2.js'

export const setupInfiniDyskRuntimeSupported = capabilities => capabilities?.setup_arrangements === true
  && capabilities?.setup_infinidysk_runtime_choices === true
  && capabilities?.setup_infinidysk_runtime_protocol === 1
  && infinidyskV2Support(capabilities).migration

export const isSetupInfiniDyskRuntimeField = field => /^(?:infinidysk|nzbdav)::(?:runtime_generation|mount_backend)$/.test(field?.key || '')

export const setupRuntimeFields = (fields, capabilities) => (Array.isArray(fields) ? fields : [])
  .filter(field => !isSetupInfiniDyskRuntimeField(field) || setupInfiniDyskRuntimeSupported(capabilities))

export const setupRuntimeValues = (values, capabilities) => Object.fromEntries(Object.entries(values || {})
  .filter(([key]) => !isSetupInfiniDyskRuntimeField({ key }) || setupInfiniDyskRuntimeSupported(capabilities)))

const nativeServices = ['infinidysk', 'nzbdav']
const runtimeOptions = new Set(['runtime_generation', 'mount_backend', 'mount_path', 'v2_runtime_dir', 'v2_data_dir', 'v2_release_version'])
const legacyOptions = new Set(['branch_enabled', 'branch', 'commit_sha', 'release_version_enabled', 'release_version', 'repo_owner', 'repo_name', 'command', 'config_dir', 'env'])
export const isSetupInfiniDyskLegacyOption = key => legacyOptions.has(key)

export const setupInfiniDyskCoreOptions = (serviceKey, options, native = false) => !nativeServices.includes(serviceKey) ? options
  : Object.fromEntries(Object.entries(options || {}).filter(([key]) => !runtimeOptions.has(key) && !(native && legacyOptions.has(key))))

export const setupInfiniDyskTopologies = (plan, capabilities) => {
  if (!setupInfiniDyskRuntimeSupported(capabilities)) return {}
  const result = {}
  for (const service of Array.isArray(plan?.services) ? plan.services : []) {
    const topology = service?.runtime_topology
    if (!nativeServices.includes(service?.service_key) || !['1', '2'].includes(topology?.runtime_generation)
      || !['rclone', 'fuse'].includes(topology?.mount_backend)
      || topology.runtime_generation === '1' && topology.mount_backend !== 'rclone'
      || typeof topology.mount_path !== 'string' || !topology.mount_path.startsWith('/') || topology.mount_path.includes('\0')
      || !Array.isArray(topology.dependencies) || !topology.dependencies.every(key => typeof key === 'string')
      || topology.dependencies.includes('rclone') !== (topology.mount_backend === 'rclone')) continue
    result[service.service_key] = { ...topology, dependencies: [...topology.dependencies] }
  }
  return result
}

const resolvedTopology = (metadata, topologies) => topologies[metadata.key] || topologies[nativeServices.find(key => key !== metadata.key)]
    || metadata.service_options?.[metadata.key] || {}

export const setupInfiniDyskUsesNativeRuntime = (metadata, topologies = {}) => nativeServices.includes(metadata?.key)
  && resolvedTopology(metadata, topologies).runtime_generation === '2'

export const setupInfiniDyskNeedsRclone = (metadata, topologies = {}) => {
  if (!nativeServices.includes(metadata?.key)) return true
  const topology = resolvedTopology(metadata, topologies)
  return !(topology.runtime_generation === '2' && topology.mount_backend === 'fuse')
}

export const setupNativeTransition = (action, capabilities) => {
  const transition = action?.native_transition
  if (!setupInfiniDyskRuntimeSupported(capabilities)
    || action?.kind !== 'native_transition' || action?.action !== 'native_transition'
    || !['infinidysk', 'nzbdav'].includes(action?.service_key)
    || transition?.runtime_generation !== '2'
    || !['fresh', 'migrate'].includes(transition?.mode)
    || !['rclone', 'fuse'].includes(transition?.mount_backend)) return null
  return { runtime_generation: '2', mode: transition.mode, mount_backend: transition.mount_backend }
}
