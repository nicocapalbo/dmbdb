const preset = ({
  id,
  label,
  source = 'custom_oidc',
  providerName = label,
  description,
  issuerUrl = '',
  discoveryUrl = '',
  issuerPlaceholder = 'https://id.example.com',
  scopes = ['openid', 'profile', 'email'],
  usernameClaim = 'preferred_username',
  groupsClaim = 'groups',
  groupsHint = 'Leave blank to allow every authenticated user.',
}) => ({
  id,
  label,
  source,
  providerName,
  description,
  issuerUrl,
  discoveryUrl,
  issuerPlaceholder,
  scopes,
  usernameClaim,
  groupsClaim,
  groupsHint,
})

export const OIDC_PROVIDER_PRESETS = [
  preset({
    id: 'managed-authelia',
    label: 'DUMB-managed Authelia',
    source: 'managed',
    providerName: 'Authelia',
    description: 'Uses the Authelia instance bootstrapped by DUMB. DUMB creates and stores its OIDC client secret automatically.',
    issuerPlaceholder: 'Managed by the Authelia service',
    scopes: ['openid', 'profile', 'email', 'groups'],
  }),
  preset({
    id: 'external-authelia',
    label: 'External Authelia',
    source: 'external_authelia',
    providerName: 'Authelia',
    description: 'Connects an independently managed Authelia deployment through its standard OIDC discovery document.',
    issuerPlaceholder: 'https://auth.example.com',
    scopes: ['openid', 'profile', 'email', 'groups'],
  }),
  preset({
    id: 'google',
    label: 'Google',
    providerName: 'Google',
    description: 'Uses Google OpenID Connect. Create a Web application OAuth client in Google Cloud and register DUMB’s redirect URI.',
    issuerUrl: 'https://accounts.google.com',
    discoveryUrl: 'https://accounts.google.com/.well-known/openid-configuration',
    issuerPlaceholder: 'https://accounts.google.com',
    usernameClaim: 'email',
    groupsHint: 'Google’s standard OIDC claims do not include Google Group membership. Leave this blank unless your provider adds a custom groups claim.',
  }),
  preset({
    id: 'authentik',
    label: 'Authentik',
    providerName: 'Authentik',
    description: 'Enter the issuer URL shown by your Authentik OAuth2/OpenID provider or application.',
    issuerPlaceholder: 'https://auth.example.com/application/o/dumb/',
  }),
  preset({
    id: 'keycloak',
    label: 'Keycloak',
    providerName: 'Keycloak',
    description: 'Enter the complete realm issuer. DUMB derives the realm discovery URL automatically.',
    issuerPlaceholder: 'https://keycloak.example.com/realms/example',
  }),
  preset({
    id: 'microsoft-entra',
    label: 'Microsoft Entra ID',
    providerName: 'Microsoft',
    description: 'Enter your tenant-specific Microsoft identity platform v2 issuer URL.',
    issuerPlaceholder: 'https://login.microsoftonline.com/tenant-id/v2.0',
  }),
  preset({
    id: 'auth0',
    label: 'Auth0',
    providerName: 'Auth0',
    description: 'Enter the issuer URL for your Auth0 tenant or custom domain.',
    issuerPlaceholder: 'https://tenant.example.auth0.com',
  }),
  preset({
    id: 'okta',
    label: 'Okta',
    providerName: 'Okta',
    description: 'Enter the issuer for the Okta authorization server used by your DUMB application.',
    issuerPlaceholder: 'https://example.okta.com/oauth2/default',
  }),
  preset({
    id: 'zitadel',
    label: 'ZITADEL',
    providerName: 'ZITADEL',
    description: 'Enter your ZITADEL instance or custom-domain issuer URL.',
    issuerPlaceholder: 'https://example.zitadel.cloud',
  }),
  preset({
    id: 'dex',
    label: 'Dex',
    providerName: 'Dex',
    description: 'Enter the issuer URL configured by your Dex deployment.',
    issuerPlaceholder: 'https://dex.example.com',
    scopes: ['openid', 'profile', 'email', 'groups'],
  }),
  preset({
    id: 'custom',
    label: 'Custom / Generic OIDC',
    providerName: 'Single Sign-On',
    description: 'Use any standards-compatible provider that publishes an OpenID Connect discovery document.',
  }),
]

export const getOidcProviderPreset = (id) => (
  OIDC_PROVIDER_PRESETS.find((entry) => entry.id === id)
  || OIDC_PROVIDER_PRESETS.find((entry) => entry.id === 'custom')
)

export const availableOidcProviderPresets = ({ managedAutheliaConfigured = false } = {}) => (
  OIDC_PROVIDER_PRESETS.filter((entry) => (
    entry.id !== 'managed-authelia' || managedAutheliaConfigured
  ))
)

export const detectOidcProviderPreset = ({ source = '', issuerUrl = '' } = {}) => {
  const normalizedSource = String(source || '').trim().toLowerCase()
  const issuer = String(issuerUrl || '').trim().toLowerCase()
  let hostname = ''
  let pathname = ''
  try {
    const url = new URL(issuer)
    hostname = url.hostname.toLowerCase()
    pathname = url.pathname.toLowerCase()
  } catch {
    // Preserve the source-based fallbacks below for incomplete configurations.
  }

  if (normalizedSource === 'managed') return 'managed-authelia'
  if (normalizedSource === 'external_authelia') return 'external-authelia'
  if (hostname === 'accounts.google.com') return 'google'
  if (hostname === 'login.microsoftonline.com') return 'microsoft-entra'
  if (hostname.endsWith('.auth0.com')) return 'auth0'
  if (hostname.endsWith('.okta.com') || hostname.endsWith('.oktapreview.com')) return 'okta'
  if (hostname.includes('zitadel')) return 'zitadel'
  if (pathname.includes('/realms/')) return 'keycloak'
  if (pathname.includes('/application/o/')) return 'authentik'
  return 'custom'
}
