import { defineStore } from 'pinia'
import { useProcessesStore } from '~/stores/processes.js'
import { extractRestartInfo } from '~/helper/restartInfo.js'
import { refreshTokenForWebSocket } from '@/services/auth'

let socket = null
let reconnectTimer = null
let reconnectAttempts = 0
let shouldReconnect = true
let isConnecting = false
let authFailurePause = false
let lastOptions = { interval: 2, health: true }

const buildUrl = ({ interval = 2, health = true } = {}) => {
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
  const params = new URLSearchParams()
  params.set('interval', String(interval))
  if (health) params.set('health', 'true')

  // Include access token when auth is enabled.
  const token = localStorage.getItem('dumb_access_token') || sessionStorage.getItem('dumb_access_token')
  if (token) {
    params.set('token', token)
  }

  const url = `${protocol}://${window.location.host}/ws/status?${params.toString()}`
  return url
}

const scheduleReconnect = (connectFn) => {
  reconnectAttempts += 1
  const delay = Math.min(1000 * (2 ** Math.min(reconnectAttempts - 1, 5)), 30000)
  if (reconnectTimer) clearTimeout(reconnectTimer)
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    connectFn()
  }, delay)
}

const isAuthCloseEvent = (event) => {
  if (!event) return false
  if (event.code === 1008) return true
  const reason = `${event.reason || ''}`.toLowerCase()
  return reason.includes('auth') || reason.includes('token') || reason.includes('expired')
}

const normalizeName = (value) => String(value || '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '')

const matchesName = (candidate, target) => {
  const a = normalizeName(candidate)
  const b = normalizeName(target)
  if (!a || !b) return false
  return a === b || a.includes(b) || b.includes(a)
}

export const useStatusStore = defineStore('status', {
  state: () => ({
    statusByName: {},
    status: 'disconnected',
    error: null,
  }),
  actions: {
    connect(options = {}) {
      if (!process.client) return
      if (!shouldReconnect) return
      if (authFailurePause) return
      if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
        return
      }
      if (isConnecting) return

      lastOptions = { ...lastOptions, ...options }
      isConnecting = true
      this.status = 'connecting'
      this.error = null
      authFailurePause = false

      const ws = new WebSocket(buildUrl(lastOptions))
      socket = ws

      ws.addEventListener('open', () => {
        if (socket !== ws) {
          ws.close()
          return
        }
        isConnecting = false
        reconnectAttempts = 0
        this.status = 'connected'
      })

      ws.addEventListener('message', (event) => {
        if (socket !== ws) return
        try {
          const payload = JSON.parse(event.data)
          this.applyPayload(payload)
        } catch (error) {
          this.error = 'Unable to parse status payload.'
        }
      })

      ws.addEventListener('error', () => {
        if (socket !== ws) return
        this.error = 'WebSocket error. Reconnecting...'
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          ws.close()
        }
      })

      ws.addEventListener('close', async (event) => {
        if (socket !== ws) return
        isConnecting = false
        socket = null
        this.status = 'disconnected'
        if (shouldReconnect) {
          if (isAuthCloseEvent(event)) {
            const refreshed = await refreshTokenForWebSocket()
            if (refreshed) {
              reconnectAttempts = 0
              this.connect(lastOptions)
              return
            }
            authFailurePause = true
            shouldReconnect = false
            this.error = 'Status websocket authentication failed. Sign in again.'
            return
          }
          scheduleReconnect(() => this.connect(lastOptions))
        }
      })
    },
    disconnect() {
      shouldReconnect = false
      authFailurePause = false
      if (reconnectTimer) {
        clearTimeout(reconnectTimer)
        reconnectTimer = null
      }
      if (socket) {
        socket.close()
        socket = null
      }
      isConnecting = false
      reconnectAttempts = 0
      this.status = 'disconnected'
    },
    resume(options = {}) {
      shouldReconnect = true
      authFailurePause = false
      reconnectAttempts = 0
      this.connect(options && Object.keys(options).length ? options : lastOptions)
    },
    applyPayload(payload) {
      if (!payload || payload.type !== 'status') return

      if (Array.isArray(payload.processes)) {
        payload.processes.forEach((process) => {
          const name = process?.process_name
          if (!name) return
          const restart = extractRestartInfo(process)
          this.statusByName[name] = {
            status: process.status ?? 'unknown',
            healthy: typeof process.healthy === 'boolean' ? process.healthy : null,
            health_reason: typeof process.health_reason === 'string' ? process.health_reason : null,
            restart,
          }
        })
        return
      }

      if (Array.isArray(payload.running)) {
        const processesStore = useProcessesStore()
        const processes = processesStore.processesList || []
        const running = payload.running.filter(Boolean)

        if (processes.length) {
          processes.forEach((process) => {
            const processName = process?.process_name
            if (!processName) return
            const candidates = [
              process.process_name,
              process.name,
              process.display_name,
              process.config_key,
            ].filter(Boolean)
            const isRunning = running.some((name) =>
              candidates.some((candidate) => matchesName(candidate, name))
            )
            this.statusByName[processName] = {
              ...(this.statusByName[processName] || {}),
              status: isRunning ? 'running' : 'stopped',
              healthy: null,
              health_reason: null,
              restart: (this.statusByName[processName] || {}).restart ?? null,
            }
          })
          return
        }

        const runningSet = new Set(running)
        running.forEach((name) => {
          this.statusByName[name] = {
            ...(this.statusByName[name] || {}),
            status: 'running',
            healthy: null,
            health_reason: null,
            restart: (this.statusByName[name] || {}).restart ?? null,
          }
        })
        Object.keys(this.statusByName).forEach((name) => {
          this.statusByName[name] = {
            ...this.statusByName[name],
            status: runningSet.has(name) ? 'running' : 'stopped',
            healthy: null,
            health_reason: null,
            restart: this.statusByName[name]?.restart ?? null,
          }
        })
      }
    },
  },
})
