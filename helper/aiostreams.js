const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])

const isLoopbackHost = (hostname) => {
  const normalized = String(hostname || '').trim().toLowerCase()
  return LOOPBACK_HOSTS.has(normalized) || normalized.endsWith('.localhost')
}

export const validateAioStreamsBaseUrl = (value) => {
  const raw = String(value || '').trim()
  if (!raw) {
    return {
      valid: false,
      message: 'AIOStreams requires the public URL that Stremio and OAuth callbacks will use.',
    }
  }

  let parsed
  try {
    parsed = new URL(raw)
  } catch {
    return { valid: false, message: 'Enter a complete URL, including https://.' }
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return { valid: false, message: 'BASE_URL must use HTTP or HTTPS.' }
  }
  if (parsed.username || parsed.password) {
    return { valid: false, message: 'BASE_URL cannot contain embedded credentials.' }
  }
  if (parsed.search || parsed.hash) {
    return { valid: false, message: 'BASE_URL cannot contain a query string or fragment.' }
  }
  if (parsed.protocol !== 'https:' && !isLoopbackHost(parsed.hostname)) {
    return {
      valid: false,
      message: 'Use HTTPS unless AIOStreams is available only on localhost.',
    }
  }

  return { valid: true, message: '' }
}

export const isValidAioStreamsBaseUrl = (value) => validateAioStreamsBaseUrl(value).valid

export const validateAioStreamsAdminCredentials = (usernameValue, passwordValue) => {
  const username = String(usernameValue || '').trim()
  const password = String(passwordValue || '')

  if (!username) {
    return { valid: false, message: 'Enter an administrator username for the AIOStreams dashboard.' }
  }
  if (username.length > 128 || /[,:=|\r\n]/.test(username)) {
    return {
      valid: false,
      message: 'The username cannot contain commas, colons, equals signs, pipes, or line breaks.',
    }
  }
  if (!password) {
    return { valid: false, message: 'Enter an administrator password for the AIOStreams dashboard.' }
  }
  if (password !== password.trim()) {
    return { valid: false, message: 'The password cannot begin or end with whitespace.' }
  }
  if (password.length < 12 || password.length > 256) {
    return { valid: false, message: 'Use a password between 12 and 256 characters.' }
  }
  if (/[,\r\n]/.test(password)) {
    return { valid: false, message: 'The password cannot contain commas or line breaks.' }
  }

  return { valid: true, message: '' }
}

export const isValidAioStreamsAdminCredentials = (username, password) => (
  validateAioStreamsAdminCredentials(username, password).valid
)
