const cleanMermaidLabel = (value) => String(value ?? '')
  .replace(/[^\p{L}\p{N}\s.,:;()/_+\-]/gu, ' ')
  .replace(/\s+/g, ' ')
  .trim()

export const sanitizeMermaidIdentifier = (value, fallback = 'node') => {
  const cleaned = String(value ?? '').replace(/[^a-zA-Z0-9_]/g, '_')
  if (cleaned) return cleaned
  return String(fallback || 'node').replace(/[^a-zA-Z0-9_]/g, '_') || 'node'
}

export const sanitizeMermaidLabel = (value, fallback = '') => {
  const cleaned = cleanMermaidLabel(value)
  if (cleaned) return cleaned
  return cleanMermaidLabel(fallback)
}
