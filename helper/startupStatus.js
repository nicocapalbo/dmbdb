const phases = {
  initializing: 'Initializing DUMB', preinstalling: 'Preinstalling enabled services',
  starting_services: 'Starting enabled services', stabilizing: 'Waiting for service readiness',
  degraded: 'Startup completed with degraded services',
  recovery_required: 'Installation recovery requires attention',
}
export function startupDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return ''
  const elapsed = Math.floor(seconds)
  return elapsed >= 3600 ? Math.floor(elapsed / 3600) + 'h ' + Math.floor(elapsed % 3600 / 60) + 'm'
    : elapsed >= 60 ? Math.floor(elapsed / 60) + 'm ' + elapsed % 60 + 's' : elapsed + 's'
}
export function startupReadiness(status, now = Date.now()) {
  const data = status && typeof status === 'object' ? status : {}
  const services = data.services && typeof data.services === 'object' ? data.services : {}
  const expected = Array.isArray(data.expected_services) ? data.expected_services.filter(name => typeof name === 'string') : Object.keys(services)
  const names = [...new Set(expected)].slice(0, 200)
  const entries = names.map(name => {
    const detail = services[name] || {}
    return { name, state: detail.state || 'pending', reason: typeof detail.reason === 'string' ? detail.reason.slice(0, 600) : 'No readiness result has been reported.' }
  })
  const pending = data.phase === 'recovery_required' ? [] : entries.filter(entry => entry.state !== 'ready')
  const failures = Object.entries(data.failures || {}).slice(0, 200).map(([name, reason]) => ({ name, reason: typeof reason === 'string' ? reason.slice(0, 600) : 'Missed the readiness deadline.' }))
  const start = Number(data.started_at)
  const finish = Number(data.completed_at)
  const elapsed = Number.isFinite(start) && start > 0 ? startupDuration(((finish > 0 ? finish * 1000 : now) - start * 1000) / 1000) : ''
  let message = names.length ? (names.length - pending.length) + ' of ' + names.length + ' expected services report ready.'
    : 'The controller has not reported its expected services yet.'
  if (data.phase === 'recovery_required') message = 'Normal services and background workers are paused. Complete installation recovery, then restart DUMB before normal services resume.'
  else if (data.phase === 'stabilizing' && names.length && !pending.length) message += ' DUMB is confirming that readiness remains stable.'
  else if (pending.length) message += ' Waiting for the services listed below.'
  return { label: phases[data.phase] || 'Starting DUMB', elapsed, message, pending, failures }
}
