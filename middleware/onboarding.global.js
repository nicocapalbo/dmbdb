// middleware/onboarding.client.js
import { defineNuxtRouteMiddleware, navigateTo } from '#imports'
import { useOnboardingStore } from '~/stores/onboarding.js'

export default defineNuxtRouteMiddleware(async (to) => {
  // 1) ensure we've fetched the flag once
  const onboard = useOnboardingStore()
  if (onboard.needsOnboarding === null) {
    // initialize needsOnboarding to null in the store
    // then flip to true/false in check()
    console.debug('Onboarding: checking status...')  
    await onboard.check()
  }

  // 2) if onboarding is still required, divert to the wizard
  if (onboard.needsOnboarding && to.path !== '/onboarding') {
    return navigateTo('/onboarding')
  }
})
