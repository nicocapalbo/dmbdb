/**
 * Authentication store for managing user authentication state
 */
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { authRepository } from '@/services/auth'

export const useAuthStore = defineStore('auth', () => {
  const authService = authRepository()

  // State
  const user = ref(null)
  const isAuthEnabled = ref(false)
  const hasUsers = ref(false)
  const authSupported = ref(true) // Track if backend supports auth endpoints
  const setupSkipped = ref(false) // Track if user explicitly skipped auth setup
  const loading = ref(false)
  const error = ref(null)
  const _initialized = ref(false) // Track if we've attempted initialization

  // Computed
  const isAuthenticated = computed(() => !!user.value && authService.isAuthenticated())
  const needsAuth = computed(() => isAuthEnabled.value && !isAuthenticated.value)

  /**
   * Check auth status from backend to determine if auth is enabled
   */
  const checkAuthStatus = async () => {
    try {
      loading.value = true
      error.value = null

      const status = await authService.getAuthStatus()
      isAuthEnabled.value = status.enabled
      hasUsers.value = status.has_users
      setupSkipped.value = status.setup_skipped || false
      authSupported.value = true

      // If auth is enabled and we have a token, verify it
      if (isAuthEnabled.value && authService.isAuthenticated()) {
        await verifyCurrentToken()
      }

      return status
    } catch (err) {
      // If backend doesn't support auth endpoints (old version), mark as not supported
      console.warn('Auth endpoints not available - backend may not support authentication:', err.message)
      authSupported.value = false
      isAuthEnabled.value = false
      hasUsers.value = false
      setupSkipped.value = false
      return { enabled: false, has_users: false, supported: false }
    } finally {
      loading.value = false
    }
  }

  /**
   * Verify the current access token is still valid
   */
  const verifyCurrentToken = async () => {
    const token = authService.getAccessToken()
    if (!token) {
      user.value = null
      return false
    }

    try {
      const result = await authService.verifyToken(token)
      if (result.valid) {
        user.value = { username: result.username }
        return true
      } else {
        // Token is invalid, try to refresh
        return await refreshAccessToken()
      }
    } catch (err) {
      console.warn('Token verification failed:', err.message)
      // Try to refresh token
      return await refreshAccessToken()
    }
  }

  /**
   * Refresh the access token
   */
  const refreshAccessToken = async () => {
    try {
      await authService.refreshToken()
      // Verify the new token
      return await verifyCurrentToken()
    } catch (err) {
      console.warn('Token refresh failed:', err.message)
      // Refresh failed, clear auth state
      user.value = null
      authService.clearTokens()
      return false
    }
  }

  /**
   * Login with username and password
   */
  const login = async (username, password, rememberMe = false) => {
    try {
      loading.value = true
      error.value = null

      await authService.login(username, password, rememberMe)
      user.value = { username }

      return true
    } catch (err) {
      error.value = err.response?.data?.detail || err.message || 'Login failed'
      console.error('Login error:', error.value)
      return false
    } finally {
      loading.value = false
    }
  }

  /**
   * Logout the current user
   */
  const logout = () => {
    authService.logout()
    user.value = null
    error.value = null
  }

  /**
   * Initial setup - create first user and enable authentication
   */
  const setup = async (username, password) => {
    try {
      loading.value = true
      error.value = null

      await authService.initialSetup(username, password)
      user.value = { username }

      // Update status to reflect auth is now enabled
      isAuthEnabled.value = true
      hasUsers.value = true

      return true
    } catch (err) {
      error.value = err.response?.data?.detail || err.message || 'Setup failed'
      console.error('Setup error:', error.value)
      return false
    } finally {
      loading.value = false
    }
  }

  /**
   * Skip authentication setup - continue without auth
   */
  const skipSetup = async () => {
    try {
      loading.value = true
      error.value = null

      await authService.skipSetup()

      // Update status - auth remains disabled, no users, setup was skipped
      isAuthEnabled.value = false
      hasUsers.value = false
      setupSkipped.value = true

      return true
    } catch (err) {
      error.value = err.response?.data?.detail || err.message || 'Skip setup failed'
      console.error('Skip setup error:', error.value)
      return false
    } finally {
      loading.value = false
    }
  }

  /**
   * Enable authentication
   */
  const enableAuth = async () => {
    try {
      loading.value = true
      error.value = null

      await authService.enableAuth()

      // Update status - auth is now enabled
      isAuthEnabled.value = true

      return true
    } catch (err) {
      error.value = err.response?.data?.detail || err.message || 'Enable auth failed'
      console.error('Enable auth error:', error.value)
      return false
    } finally {
      loading.value = false
    }
  }

  /**
   * Disable authentication
   */
  const disableAuth = async () => {
    try {
      loading.value = true
      error.value = null

      await authService.disableAuth()

      // Update status - auth is now disabled
      isAuthEnabled.value = false

      return true
    } catch (err) {
      error.value = err.response?.data?.detail || err.message || 'Disable auth failed'
      console.error('Disable auth error:', error.value)
      return false
    } finally {
      loading.value = false
    }
  }

  /**
   * Initialize auth state on app load
   */
  const initialize = async () => {
    try {
      await checkAuthStatus()
    } finally {
      _initialized.value = true
    }
  }

  return {
    // State
    user,
    isAuthEnabled,
    hasUsers,
    authSupported,
    setupSkipped,
    loading,
    error,
    _initialized,

    // Computed
    isAuthenticated,
    needsAuth,

    // Actions
    checkAuthStatus,
    login,
    logout,
    setup,
    skipSetup,
    enableAuth,
    disableAuth,
    refreshAccessToken,
    verifyCurrentToken,
    initialize
  }
})
