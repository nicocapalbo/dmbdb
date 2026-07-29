export const UI_SERVICE_COOKIE = 'dumb_ui_service'

const routeServiceId = (route) => {
  const value = route?.params?.serviceId
  const serviceId = Array.isArray(value) ? value[0] : value
  return typeof serviceId === 'string' && serviceId.trim()
    ? serviceId.trim().toLowerCase()
    : null
}

export const shouldClearUiServiceContext = (to, from = null) => {
  const destinationServiceId = routeServiceId(to)
  if (!destinationServiceId) return true

  const sourceServiceId = routeServiceId(from)
  return !sourceServiceId || sourceServiceId !== destinationServiceId
}

export const clearUiServiceContextCookie = () => {
  if (!globalThis.document) return
  globalThis.document.cookie = `${UI_SERVICE_COOKIE}=; path=/; Max-Age=0; SameSite=Lax`
}
