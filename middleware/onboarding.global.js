// middleware/onboarding.client.js
import { defineNuxtRouteMiddleware, navigateTo } from '#imports'
import { useOnboardingStore } from '~/stores/onboarding.js'
import { useAuthStore } from '~/stores/auth.js'

export default defineNuxtRouteMiddleware(async (to) => {
  // IMPORTANT: Skip onboarding check if on auth pages (setup/login)
  // Auth setup must be completed BEFORE onboarding can be checked
  const authPages = ['/setup', '/login']
  if (authPages.includes(to.path)) {
    return
  }

  // Skip onboarding check if auth setup hasn't been completed yet
  const authStore = useAuthStore()
  if (!authStore.hasUsers && !authStore.setupSkipped) {
    // No users exist yet and setup wasn't skipped - auth setup is required first
    // Don't check onboarding until auth is set up or skipped
    return
  }

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
