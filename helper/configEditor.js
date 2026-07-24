export function normalizeJsonEditorValue(value) {
  if (typeof value !== 'string') return value

  try {
    return JSON.parse(value)
  } catch (error) {
    throw new Error(`Invalid JSON: ${error.message}`)
  }
}
