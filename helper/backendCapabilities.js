export const capabilityEnabled = (capabilities, key) => (
  capabilities != null
  && typeof capabilities === 'object'
  && capabilities[key] === true
)

export const autheliaIntegrationSupported = (capabilities) => (
  capabilityEnabled(capabilities, 'authelia_integration')
)

export const authCapabilitySupport = (capabilities) => {
  const oidc = capabilityEnabled(capabilities, 'auth_oidc')
  return {
    oidc,
    hybrid: oidc && capabilityEnabled(capabilities, 'auth_hybrid'),
  }
}

export const filterOptionalServicesByCapabilities = (services, capabilities) => {
  const entries = Array.isArray(services) ? services : []
  return entries.filter((service) => (
    service?.key !== 'authelia' || autheliaIntegrationSupported(capabilities)
  ))
}
