import { defineStore } from 'pinia'
import { useProcessesStore } from '~/stores/processes.js'
import { extractRestartInfo } from '~/helper/restartInfo.js'

let socket = null
let reconnectTimer = null
let reconnectAttempts = 0
let connectTimer = null
let shouldReconnect = true
let isConnecting = false

const buildUrl = ({ interval = 2, health = true } = {}) => {
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
  const params = new URLSearchParams()
  params.set('interval', String(interval))
  if (health) params.set('health', 'true')
  return `${protocol}://${window.location.host}/ws/status?${params.toString()}`
}

const scheduleReconnect = (connectFn) => {
  reconnectAttempts += 1
  const delay = Math.min(1000 * reconnectAttempts, 10000)
  if (reconnectTimer) clearTimeout(reconnectTimer)
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    connectFn()
  }, delay)
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
      if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
        return
      }
      if (isConnecting) return

      isConnecting = true
      this.status = 'connecting'
      this.error = null

      socket = new WebSocket(buildUrl(options))

      if (connectTimer) clearTimeout(connectTimer)
      connectTimer = setTimeout(() => {
        if (socket && socket.readyState !== WebSocket.OPEN) {
          socket.close()
          isConnecting = false
          this.status = 'disconnected'
          if (shouldReconnect) {
            scheduleReconnect(() => this.connect(options))
          }
        }
      }, 8000)

      socket.addEventListener('open', () => {
        isConnecting = false
        reconnectAttempts = 0
        this.status = 'connected'
        if (connectTimer) {
          clearTimeout(connectTimer)
          connectTimer = null
        }
      })

      socket.addEventListener('message', (event) => {
        try {
          const payload = JSON.parse(event.data)
          this.applyPayload(payload)
        } catch (error) {
          this.error = 'Unable to parse status payload.'
        }
      })

      socket.addEventListener('error', () => {
        this.error = 'WebSocket error. Reconnecting...'
        if (socket) socket.close()
      })

      socket.addEventListener('close', () => {
        isConnecting = false
        this.status = 'disconnected'
        if (connectTimer) {
          clearTimeout(connectTimer)
          connectTimer = null
        }
        if (shouldReconnect) {
          scheduleReconnect(() => this.connect(options))
        }
      })
    },
    disconnect() {
      shouldReconnect = false
      if (reconnectTimer) {
        clearTimeout(reconnectTimer)
        reconnectTimer = null
      }
      if (connectTimer) {
        clearTimeout(connectTimer)
        connectTimer = null
      }
      if (socket) {
        socket.close()
        socket = null
      }
      isConnecting = false
      this.status = 'disconnected'
    },
    resume(options = {}) {
      shouldReconnect = true
      this.connect(options)
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
