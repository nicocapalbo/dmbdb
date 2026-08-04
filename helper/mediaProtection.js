export const MEDIA_PROTECTION_OVERRIDES = Object.freeze({
  SAFE: 'safe',
  KEEP_RUNNING: 'keep_running',
  STOP_NOW: 'stop_now',
})

export const summarizeMediaProtection = (preflight = {}) => {
  const servers = Array.isArray(preflight?.media_servers) ? preflight.media_servers : []
  const busy = servers.filter((entry) => entry?.activity?.state === 'busy')
  const unknown = servers.filter((entry) => entry?.activity?.state === 'unknown')
  return {
    protected: preflight?.protected === true && servers.length > 0,
    blocked: preflight?.blocked === true,
    serverCount: servers.length,
    busyNames: busy.map((entry) => entry?.process_name).filter(Boolean),
    unknownNames: unknown.map((entry) => entry?.process_name).filter(Boolean),
  }
}
