// One ordered list owns rendering, navigation and service-page offsets.
export function onboardingSteps({ providers = [], services = [], serviceUi = false, arrangements = false } = {}) {
  return [
    { id: 'services', component: 'services', label: 'Choose services' },
    { id: 'preflight', component: 'preflight', label: 'Readiness checks' },
    ...providers.map((entry, index) => ({ id: 'provider:' + index, component: 'provider', label: 'Provider credentials', providerIndex: index })),
    { id: 'companions', component: 'companions', label: 'Companion services' },
    ...services.map(key => ({ id: 'options:' + key, component: 'options', label: 'Service options', serviceKey: key })),
    ...(arrangements ? [{ id: 'arrangement', component: 'arrangement', label: 'Connections and choices' }] : []),
    ...(serviceUi ? [{ id: 'service-ui', component: 'serviceUi', label: 'Embedded service access' }] : []),
    { id: 'review', component: 'review', label: 'Review setup' },
    { id: 'progress', component: 'progress', label: 'Setup progress' },
    { id: 'result', component: 'result', label: 'Setup results' },
    { id: 'error', component: 'error', label: 'Setup needs attention' },
  ]
}
export const onboardingStepNumber = (steps, id) => steps.findIndex(entry => entry.id === id) + 1
