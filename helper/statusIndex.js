export const createStatusIndex = () => new Map()

export const setStatusEntry = (index, name, value) => {
  if (!(index instanceof Map)) {
    throw new TypeError('Status index must be a Map')
  }
  index.set(String(name), value)
  return value
}
