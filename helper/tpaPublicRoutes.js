const normalizeName = (value) => String(value || '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '')

export const isTpaServiceKey = (value) => (
  normalizeName(value) === 'traefikproxyadmin'
)

const safeHttpsOrigin = (value) => {
  try {
    const parsed = new URL(String(value || ''))
    if (
      parsed.protocol !== 'https:'
      || !parsed.hostname
      || parsed.username
      || parsed.password
      || (parsed.pathname && parsed.pathname !== '/')
      || parsed.search
      || parsed.hash
    ) return ''
    return parsed.origin
  } catch {
    return ''
  }
}

export const selectTpaPublicRoute = (routes, { names = [], ports = [] } = {}) => {
  const serviceNames = names.map(normalizeName).filter(Boolean)
  const servicePorts = new Set(
    ports
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value >= 1 && value <= 65535),
  )

  const matches = []
  for (const route of Array.isArray(routes) ? routes : []) {
    if (!route?.enabled || !servicePorts.has(Number(route?.target_port))) continue
    const publicUrl = (Array.isArray(route?.public_urls) ? route.public_urls : [])
      .map(safeHttpsOrigin)
      .find(Boolean)
    if (!publicUrl) continue

    const routeName = normalizeName(route?.name)
    const exactName = routeName && serviceNames.includes(routeName)
    const relatedName = routeName && serviceNames.some((name) => (
      name.includes(routeName) || routeName.includes(name)
    ))
    if (!route?.target_loopback && !exactName && !relatedName) continue

    matches.push({
      route,
      publicUrl,
      score: (exactName ? 100 : relatedName ? 50 : 0) + (route?.target_loopback ? 25 : 0),
    })
  }

  matches.sort((left, right) => (
    right.score - left.score
    || String(left.route?.name || '').localeCompare(String(right.route?.name || ''))
    || left.publicUrl.localeCompare(right.publicUrl)
  ))
  return matches[0] || null
}
