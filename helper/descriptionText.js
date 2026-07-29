const URL_PATTERN = /https?:\/\/[^\s<>"']+/gi

const normalizeText = (value) => String(value ?? '').replace(/\r\n?/g, '\n')

const splitTrailingPunctuation = (value) => {
  const match = String(value).match(/^(.*?)([.,;!?]+)?$/)
  return {
    url: match?.[1] || '',
    trailing: match?.[2] || '',
  }
}

const appendLinkedText = (parts, value) => {
  const text = String(value || '')
  let cursor = 0
  URL_PATTERN.lastIndex = 0

  for (const match of text.matchAll(URL_PATTERN)) {
    const index = match.index ?? 0
    if (index > cursor) {
      parts.push({ type: 'text', text: text.slice(cursor, index) })
    }

    const { url, trailing } = splitTrailingPunctuation(match[0])
    let href = ''
    try {
      const parsed = new URL(url)
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        href = parsed.href
      }
    } catch {
      href = ''
    }

    if (href) {
      parts.push({ type: 'link', text: url, href })
    } else {
      parts.push({ type: 'text', text: url })
    }
    if (trailing) {
      parts.push({ type: 'text', text: trailing })
    }
    cursor = index + match[0].length
  }

  if (cursor < text.length) {
    parts.push({ type: 'text', text: text.slice(cursor) })
  }
}

export const descriptionParts = (value, { lineBreaks = 'none' } = {}) => {
  const text = normalizeText(value)
  const parts = []

  if (lineBreaks === 'all') {
    text.split('\n').forEach((line, index, lines) => {
      appendLinkedText(parts, line)
      if (index < lines.length - 1) parts.push({ type: 'break', count: 1 })
    })
    return parts
  }

  if (lineBreaks === 'paragraphs') {
    const chunks = text.split(/(\n{2,})/)
    chunks.forEach((chunk) => {
      if (/^\n{2,}$/.test(chunk)) {
        parts.push({ type: 'break', count: 2 })
      } else {
        appendLinkedText(parts, chunk.replace(/\n/g, ' '))
      }
    })
    return parts
  }

  appendLinkedText(parts, text.replace(/\n/g, ' '))
  return parts
}

export const descriptionPlainText = (value) => normalizeText(value)
  .replace(/\s+/g, ' ')
  .trim()
