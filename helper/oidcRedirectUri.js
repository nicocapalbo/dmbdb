const isIpAddress = (hostname) => {
  const value = String(hostname || '').replace(/^\[|\]$/g, '')
  if (value.includes(':')) return true
  const parts = value.split('.')
  return (
    parts.length === 4
    && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)
  )
}

export const validateOidcRedirectUri = (value) => {
  let url
  try {
    url = new URL(String(value || '').trim())
  } catch {
    return 'Enter an absolute HTTPS callback URL.'
  }

  const hostname = url.hostname.toLowerCase()
  if (
    url.protocol !== 'https:'
    || !hostname
    || hostname === 'localhost'
    || hostname.endsWith('.localhost')
    || isIpAddress(hostname)
    || !hostname.includes('.')
  ) {
    return 'Use DUMB’s browser-facing HTTPS FQDN; localhost, IP addresses, and single-label hostnames are not accepted.'
  }
  if (
    url.pathname !== '/api/auth/oidc/callback'
    || url.search
    || url.hash
    || url.username
    || url.password
  ) {
    return 'Use the exact DUMB origin followed by /api/auth/oidc/callback, with no query or fragment.'
  }
  return ''
}

export const oidcRedirectUriForOrigin = (origin) => {
  try {
    const candidate = new URL('/api/auth/oidc/callback', origin).toString()
    return validateOidcRedirectUri(candidate) ? '' : candidate
  } catch {
    return ''
  }
}
