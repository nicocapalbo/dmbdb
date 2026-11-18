const failureLabels = Object.freeze({
  dns: 'Name resolution', connect: 'Connecting', tls: 'TLS connection', authentication: 'Authentication',
  connection_limit: 'Provider connection limit', timeout: 'Timed out', connection_closed: 'Connection closed',
  protocol: 'Invalid NNTP response', response_limit: 'Response size limit', provider_reply: 'Provider error reply',
  article_missing: 'Article not found', bridge_capacity: 'Bridge connection capacity', bridge_handshake: 'Bridge handshake',
})
const counter = value => Number.isSafeInteger(value) && value >= 0
const failures = value => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const rows = []
  for (const [key, label] of Object.entries(failureLabels)) {
    if (!(key in value)) continue
    if (!counter(value[key])) return null
    if (value[key] > 0) rows.push({ key, label, count: value[key] })
  }
  return rows
}

export const infinidyskV2ProviderDiagnostics = value => {
  if (!value || value.schema_version !== 1 || !Array.isArray(value.providers) || value.providers.length > 64
    || ('final' in value && typeof value.final !== 'boolean')
    || ('recorded_at' in value && !counter(value.recorded_at))) return null
  const seen = new Set(), providers = []
  for (const row of value.providers) {
    if (!row || !Number.isSafeInteger(row.provider_ordinal) || row.provider_ordinal < 1 || row.provider_ordinal > 64
      || seen.has(row.provider_ordinal) || !['requests', 'bytes_received', 'retries'].every(key => counter(row[key]))) return null
    const entries = failures(row.failures)
    if (!entries) return null
    seen.add(row.provider_ordinal)
    providers.push({ ordinal: row.provider_ordinal, requests: row.requests, bytesReceived: row.bytes_received, retries: row.retries,
      missing: entries.find(entry => entry.key === 'article_missing')?.count || 0,
      errors: entries.filter(entry => entry.key !== 'article_missing'),
    })
  }
  const unbound = failures(value.unbound_failures === undefined ? {} : value.unbound_failures)
  if (!unbound) return null
  return { final: value.final === true, providers: providers.sort((a, b) => a.ordinal - b.ordinal), unbound }
}
