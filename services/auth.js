/**
 * Authentication service for managing JWT tokens and auth operations
 */
import axios from 'axios'

const TOKEN_KEY = 'dumb_access_token'
const REFRESH_TOKEN_KEY = 'dumb_refresh_token'
const REMEMBER_ME_KEY = 'dumb_remember_me'
let websocketRefreshPromise = null

export const authRepository = () => {
  /**
   * Login with username and password
   * @param {string} username
   * @param {string} password
   * @param {boolean} rememberMe
   * @returns {Promise<{access_token: string, refresh_token: string}>}
   */
  const login = async (username, password, rememberMe = false) => {
    const response = await axios.post('/api/auth/login', {
      username,
      password
    })

    const { access_token, refresh_token } = response.data

    // Store tokens
    setTokens(access_token, refresh_token, rememberMe)

    return response.data
  }

  /**
   * Refresh the access token using the refresh token
   * @returns {Promise<{access_token: string, refresh_token: string}>}
   */
  const refreshToken = async () => {
    const refreshTokenValue = getRefreshToken()

    if (!refreshTokenValue) {
      throw new Error('No refresh token available')
    }

    const response = await axios.post('/api/auth/refresh', {
      refresh_token: refreshTokenValue
    })

    const { access_token, refresh_token } = response.data

    // Update stored tokens (preserve remember me setting)
    const rememberMe = getRememberMe()
    setTokens(access_token, refresh_token, rememberMe)

    return response.data
  }

  /**
   * Verify if the current access token is valid
   * @param {string} token
   * @returns {Promise<{valid: boolean, username?: string}>}
   */
  const verifyToken = async (token) => {
    const response = await axios.post('/api/auth/verify', null, {
      params: { token }
    })
    return response.data
  }

  /**
   * Get authentication status from backend
   * @returns {Promise<{enabled: boolean, has_users: boolean}>}
   */
  const getAuthStatus = async () => {
    const response = await axios.get('/api/auth/status')
    return response.data
  }

  /**
   * Initial setup - create first user and enable authentication
   * @param {string} username
   * @param {string} password
   * @returns {Promise<{access_token: string, refresh_token: string}>}
   */
  const initialSetup = async (username, password) => {
    const response = await axios.post('/api/auth/setup', {
      username,
      password
    })

    const { access_token, refresh_token } = response.data

    // Store tokens with remember me enabled for initial setup
    setTokens(access_token, refresh_token, true)

    return response.data
  }

  /**
   * Logout - clear all tokens
   */
  const logout = () => {
    clearTokens()
  }

  /**
   * Store tokens in storage (localStorage or sessionStorage based on rememberMe)
   * @param {string} accessToken
   * @param {string} refreshToken
   * @param {boolean} rememberMe
   */
  const setTokens = (accessToken, refreshToken, rememberMe = false) => {
    const storage = rememberMe ? localStorage : sessionStorage

    storage.setItem(TOKEN_KEY, accessToken)
    storage.setItem(REFRESH_TOKEN_KEY, refreshToken)
    storage.setItem(REMEMBER_ME_KEY, rememberMe ? 'true' : 'false')
  }

  /**
   * Get the access token from storage
   * @returns {string|null}
   */
  const getAccessToken = () => {
    return localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY)
  }

  /**
   * Get the refresh token from storage
   * @returns {string|null}
   */
  const getRefreshToken = () => {
    return localStorage.getItem(REFRESH_TOKEN_KEY) || sessionStorage.getItem(REFRESH_TOKEN_KEY)
  }

  /**
   * Get the remember me setting
   * @returns {boolean}
   */
  const getRememberMe = () => {
    const rememberMe = localStorage.getItem(REMEMBER_ME_KEY) || sessionStorage.getItem(REMEMBER_ME_KEY)
    return rememberMe === 'true'
  }

  /**
   * Clear all tokens from storage
   */
  const clearTokens = () => {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(REFRESH_TOKEN_KEY)
    localStorage.removeItem(REMEMBER_ME_KEY)
    sessionStorage.removeItem(TOKEN_KEY)
    sessionStorage.removeItem(REFRESH_TOKEN_KEY)
    sessionStorage.removeItem(REMEMBER_ME_KEY)
  }

  /**
   * Check if user is authenticated (has a valid access token)
   * @returns {boolean}
   */
  const isAuthenticated = () => {
    return !!getAccessToken()
  }

  /**
   * List all users (requires authentication)
   * @returns {Promise<{users: Array<{username: string, disabled: boolean}>}>}
   */
  const listUsers = async () => {
    const response = await axios.get('/api/auth/users')
    return response.data
  }

  /**
   * Create a new user (requires authentication)
   * @param {string} username
   * @param {string} password
   * @returns {Promise<{username: string, disabled: boolean}>}
   */
  const createUser = async (username, password) => {
    const response = await axios.post('/api/auth/users', {
      username,
      password
    })
    return response.data
  }

  /**
   * Update a user's status (requires authentication)
   * @param {string} username
   * @param {boolean} disabled
   * @returns {Promise<{username: string, disabled: boolean}>}
   */
  const updateUser = async (username, disabled) => {
    const response = await axios.put(`/api/auth/users/${username}`, {
      disabled
    })
    return response.data
  }

  /**
   * Delete a user (requires authentication)
   * @param {string} username
   * @returns {Promise<{message: string}>}
   */
  const deleteUser = async (username) => {
    const response = await axios.delete(`/api/auth/users/${username}`)
    return response.data
  }

  /**
   * Skip authentication setup
   * @returns {Promise<{message: string}>}
   */
  const skipSetup = async () => {
    const response = await axios.post('/api/auth/skip-setup')
    return response.data
  }

  /**
   * Enable authentication
   * @returns {Promise<{message: string}>}
   */
  const enableAuth = async () => {
    const response = await axios.post('/api/auth/enable')
    return response.data
  }

  /**
   * Disable authentication (requires authentication if auth is enabled)
   * @returns {Promise<{message: string}>}
   */
  const disableAuth = async () => {
    const response = await axios.post('/api/auth/disable')
    clearTokens() // Clear any existing tokens
    return response.data
  }

  return {
    login,
    refreshToken,
    verifyToken,
    getAuthStatus,
    initialSetup,
    skipSetup,
    enableAuth,
    disableAuth,
    logout,
    getAccessToken,
    getRefreshToken,
    isAuthenticated,
    clearTokens,
    listUsers,
    createUser,
    updateUser,
    deleteUser
  }
}

/**
 * Refresh helper for websocket clients.
 * Deduplicates concurrent refresh attempts when multiple sockets close at once.
 * @returns {Promise<boolean>}
 */
export const refreshTokenForWebSocket = async () => {
  const authService = authRepository()
  const refreshToken = authService.getRefreshToken()

  if (!refreshToken) {
    return false
  }

  if (!websocketRefreshPromise) {
    websocketRefreshPromise = authService.refreshToken()
      .then(() => true)
      .catch(() => false)
      .finally(() => {
        websocketRefreshPromise = null
      })
  }

  return websocketRefreshPromise
}
