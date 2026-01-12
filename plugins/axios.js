/**
 * Axios interceptor plugin for adding Authorization headers and handling token refresh
 */
import axios from 'axios'
import { authRepository } from '@/services/auth'

export default defineNuxtPlugin(() => {
  const authService = authRepository()
  let isRefreshing = false
  let refreshSubscribers = []

  /**
   * Subscribe to token refresh completion
   */
  const subscribeTokenRefresh = (callback) => {
    refreshSubscribers.push(callback)
  }

  /**
   * Notify all subscribers when token is refreshed
   */
  const onTokenRefreshed = (accessToken) => {
    refreshSubscribers.forEach(callback => callback(accessToken))
    refreshSubscribers = []
  }

  /**
   * Request interceptor - adds Authorization header if token exists
   */
  axios.interceptors.request.use(
    (config) => {
      const token = authService.getAccessToken()

      // Only add Authorization header for requests to our own API (not external URLs)
      const isExternalUrl = config.url && (
        config.url.startsWith('http://') ||
        config.url.startsWith('https://')
      )

      // Add Authorization header if token exists, not already present, and not an external URL
      if (token && !config.headers.Authorization && !isExternalUrl) {
        config.headers.Authorization = `Bearer ${token}`
      }

      return config
    },
    (error) => {
      return Promise.reject(error)
    }
  )

  /**
   * Response interceptor - handles 401 errors and token refresh
   */
  axios.interceptors.response.use(
    (response) => {
      return response
    },
    async (error) => {
      const originalRequest = error.config

      // Check if this is an external URL
      const isExternalUrl = originalRequest.url && (
        originalRequest.url.startsWith('http://') ||
        originalRequest.url.startsWith('https://')
      )

      // If error is 401 and we haven't tried to refresh yet
      if (error.response?.status === 401 && !originalRequest._retry) {
        // Don't handle 401s from external URLs or auth endpoints
        if (isExternalUrl || originalRequest.url?.includes('/api/auth/')) {
          return Promise.reject(error)
        }

        originalRequest._retry = true

        // If already refreshing, wait for the refresh to complete
        if (isRefreshing) {
          return new Promise((resolve) => {
            subscribeTokenRefresh((accessToken) => {
              originalRequest.headers.Authorization = `Bearer ${accessToken}`
              resolve(axios(originalRequest))
            })
          })
        }

        isRefreshing = true

        try {
          // Try to refresh the token
          await authService.refreshToken()
          const newAccessToken = authService.getAccessToken()

          // Update the failed request with new token
          originalRequest.headers.Authorization = `Bearer ${newAccessToken}`

          // Notify all subscribers
          onTokenRefreshed(newAccessToken)

          isRefreshing = false

          // Retry the original request
          return axios(originalRequest)
        } catch (refreshError) {
          // Refresh failed, clear tokens and redirect to login
          isRefreshing = false
          refreshSubscribers = []
          authService.clearTokens()

          // Only redirect to login if we're not already there
          if (typeof window !== 'undefined' && !window.location.pathname.includes('/login')) {
            window.location.href = '/login'
          }

          return Promise.reject(refreshError)
        }
      }

      return Promise.reject(error)
    }
  )
})
