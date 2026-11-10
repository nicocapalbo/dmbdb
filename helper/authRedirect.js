// The same relative destination is used for local login and OIDC return_to.
export const safeAuthRedirect = (value, origin) => {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return '/'
  for (const character of value) {
    const code = character.charCodeAt(0)
    if (code === 92 || code < 32 || code === 127) return '/'
  }
  try {
    const base = new URL(origin)
    if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password) return '/'
    const target = new URL(value, base.origin)
    if (target.origin !== base.origin || target.username || target.password
      || !target.pathname.startsWith('/') || target.pathname.startsWith('//')) return '/'
    return target.pathname + target.search + target.hash
  } catch { return '/' }
}
