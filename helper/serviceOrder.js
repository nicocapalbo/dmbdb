const toName = (service) => String(service?.process_name || service?.name || '').trim()

export const normalizeServiceOrder = (value) => {
  if (!Array.isArray(value)) return []
  const seen = new Set()
  const output = []
  value.forEach((entry) => {
    const name = String(entry || '').trim()
    if (!name || seen.has(name)) return
    seen.add(name)
    output.push(name)
  })
  return output
}

export const orderServicesByPreference = (services, preferredOrder) => {
  const list = Array.isArray(services) ? services : []
  const order = normalizeServiceOrder(preferredOrder)
  if (!order.length) return list

  const rank = new Map(order.map((name, index) => [name, index]))
  return [...list].sort((a, b) => {
    const aName = toName(a)
    const bName = toName(b)
    const aRank = rank.has(aName) ? rank.get(aName) : Number.POSITIVE_INFINITY
    const bRank = rank.has(bName) ? rank.get(bName) : Number.POSITIVE_INFINITY
    if (aRank !== bRank) return aRank - bRank
    return 0
  })
}

export const mergeServiceOrder = ({ visibleOrderedNames = [], allServiceNames = [], existingOrder = [] }) => {
  const visible = normalizeServiceOrder(visibleOrderedNames)
  const allNames = normalizeServiceOrder(allServiceNames)
  const existing = normalizeServiceOrder(existingOrder)
  const allSet = new Set(allNames)
  const visibleSet = new Set(visible)

  const trailingExisting = existing.filter((name) => !visibleSet.has(name) && allSet.has(name))
  const trailingSet = new Set(trailingExisting)
  const trailingAll = allNames.filter((name) => !visibleSet.has(name) && !trailingSet.has(name))

  return [...visible, ...trailingExisting, ...trailingAll]
}

