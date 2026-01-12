/**
 * Global authentication middleware
 * Priority order:
 * 1. Auth setup (/setup) - if no users exist
 * 2. Onboarding (/onboarding) - if onboarding not completed
 * 3. Login (/login) - if auth enabled and not authenticated
 */
export default defineNuxtRouteMiddleware(async (to, from) => {
  // Skip middleware on server-side
  if (process.server) return

  const authStore = useAuthStore()

  // Initialize auth status once (check if it's been initialized by checking if we've tried to load)
  // We need a flag to track if we've attempted initialization, not just check the values
  if (!authStore._initialized && !authStore.loading) {
    try {
      await authStore.initialize()
    } catch (err) {
      console.warn('Auth initialization failed:', err)
      // Even if it fails, mark as initialized to prevent infinite loop
    }
  }

  // PRIORITY 1: Auth Setup
  // If auth is supported by backend and no users exist (and setup wasn't skipped), must complete auth setup first
  if (authStore.authSupported && !authStore.hasUsers && !authStore.setupSkipped) {
    if (to.path !== '/setup') {
      return navigateTo('/setup')
    }
    return // Allow access to /setup
  }

  // Allow access to setup page only if no users exist
  if (to.path === '/setup') {
    // Users already exist, redirect based on auth status
    if (authStore.isAuthenticated) {
      return navigateTo('/')
    }
    return navigateTo('/login')
  }

  // PRIORITY 2: Onboarding
  // After auth setup is complete, check onboarding
  // Allow access to /onboarding page without blocking it
  if (to.path === '/onboarding') {
    return // Allow access to onboarding page
  }

  // PRIORITY 3: Authentication
  // Allow access to login page without auth
  if (to.path === '/login') {
    // If already authenticated, redirect to home
    if (authStore.isAuthenticated) {
      return navigateTo('/')
    }
    return
  }

  // If auth is not enabled, allow all routes
  if (!authStore.isAuthEnabled) {
    return
  }

  // Auth is enabled, check if user is authenticated
  if (!authStore.isAuthenticated) {
    // Not authenticated, redirect to login with return URL
    return navigateTo({
      path: '/login',
      query: { redirect: to.fullPath }
    })
  }

  // User is authenticated, allow access
})
