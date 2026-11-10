// These helpers only route disposable test fixtures, never application traffic.
export const realAppProxyRoute = (proxies, target) => {
  const match = typeof target === 'string' && target.match(/^\/service\/ui\/(infinidysk|seerr)(\/.*)$/)
  const proxy = match && proxies.get(match[1])
  return typeof proxy === 'function' ? { proxy, path: match[2] } : null
}

export const realAppParentHtml = target => target === '/parent/infinidysk' ? '<iframe src="/ui/infinidysk/"></iframe>'
  : target === '/parent/seerr' ? '<iframe src="/ui/seerr/"></iframe>' : null

export const embeddedParentHtml = target => {
  const service = typeof target === 'string' ? target.split('/')[2] : null
  return service === 'radarr' ? '<html><body><iframe src="/ui/radarr/" referrerpolicy="same-origin"></iframe></body></html>'
    : service === 'decypharr' ? '<html><body><iframe src="/ui/decypharr/" referrerpolicy="same-origin"></iframe></body></html>'
      : service === 'radarr_second' ? '<html><body><iframe src="/ui/radarr_second/" referrerpolicy="same-origin"></iframe></body></html>' : null
}

export const fixtureRequestPath = target => {
  if (typeof target !== 'string' || !target.startsWith('/') || target.startsWith('//')) return null
  for (const character of target) {
    const code = character.charCodeAt(0)
    if (code === 92 || code <= 32 || code === 127) return null
  }
  return target
}
