const MEDIASTORM_DEFAULT_ADMIN_PASSWORD = 'admin'
const MEDIASTORM_CREDENTIAL_KINDS = new Set(['default', 'installation_specific'])

export const normalizeMediaStormCredentialKind = (payload) => {
  const password = typeof payload?.password === 'string' ? payload.password : ''
  if (payload?.available !== true || !password) return null

  if (MEDIASTORM_CREDENTIAL_KINDS.has(payload?.credential_kind)) {
    return payload.credential_kind
  }

  return password === MEDIASTORM_DEFAULT_ADMIN_PASSWORD
    ? 'default'
    : 'installation_specific'
}
