export function normalizeJsonEditorValue(value) {
  if (typeof value !== 'string') return value

  try {
    return JSON.parse(value)
  } catch (error) {
    throw new Error(`Invalid JSON: ${error.message}`)
  }
}

export function configUpdateErrorText(error, fallback = 'Failed to update config.') {
  return String(
    error?.data?.detail
    || error?.response?.data?.detail
    || error?.data?.message
    || error?.response?.data?.message
    || error?.message
    || fallback
  )
}
