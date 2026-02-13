import { defineStore } from 'pinia'
import { refreshTokenForWebSocket } from '@/services/auth'

let socket = null
let reconnectTimer = null
let reconnectAttempts = 0
let isConnecting = false
let shouldReconnect = true
let authFailurePause = false

const readHistoryTuning = () => {
  const bucketRaw = window.localStorage?.getItem('metrics.historyBucketSeconds')
  const pointsRaw = window.localStorage?.getItem('metrics.historyMaxPoints')
  const bucket = Number(bucketRaw)
  const points = Number(pointsRaw)
  return {
    bucket: Number.isFinite(bucket) && bucket > 0 ? bucket : 5,
    points: Number.isFinite(points) && points > 0 ? points : 600,
  }
}

const buildUrl = () => {
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
  const params = new URLSearchParams()
  params.set('interval', '2')
  params.set('history', 'false')
  params.set('bootstrap', 'true')
  const tuning = readHistoryTuning()
  params.set('history_points', `${tuning.points}`)
  params.set('history_bucket', `${tuning.bucket}`)

  // Include access token when auth is enabled.
  const token = localStorage.getItem('dumb_access_token') || sessionStorage.getItem('dumb_access_token')
  if (token) {
    params.set('token', token)
  }

  const url = `${protocol}://${window.location.host}/ws/metrics?${params.toString()}`
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

export const useMetricsStore = defineStore('metrics', {
  state: () => ({
    latestSnapshot: null,
    historyItems: [],
    historySeries: null,
    historyTimestamps: [],
    historyTruncated: false,
    historyStats: null,
    historyBucketSeconds: null,
    status: 'disconnected',
    error: null,
  }),
  actions: {
    connect() {
      if (!process.client) return
      if (!shouldReconnect) return
      if (authFailurePause) return
      if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
        return
      }
      if (isConnecting) return

      isConnecting = true
      this.status = 'connecting'
      this.error = null
      authFailurePause = false

      const ws = new WebSocket(buildUrl())
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
          if (payload?.type === 'bootstrap') {
            if (payload.snapshot) {
              this.latestSnapshot = payload.snapshot
            }
            this.historyItems = Array.isArray(payload.items) ? payload.items : []
            this.historySeries = payload.series || null
            this.historyTimestamps = Array.isArray(payload.timestamps) ? payload.timestamps : []
            this.historyTruncated = Boolean(payload.truncated)
            this.historyStats = payload.stats || null
            this.historyBucketSeconds = payload.bucket_seconds ?? null
            return
          }
          if (payload?.type === 'history') {
            this.historyItems = Array.isArray(payload.items) ? payload.items : []
            this.historySeries = null
            this.historyTimestamps = this.historyItems.map((item) => item.timestamp)
            this.historyTruncated = Boolean(payload.truncated)
            this.historyStats = null
            this.historyBucketSeconds = payload.bucket_seconds ?? null
            return
          }
          if (payload?.type === 'snapshot') {
            this.latestSnapshot = payload.data
            return
          }
          if (!payload?.type && payload?.timestamp) {
            this.latestSnapshot = payload
          }
        } catch (error) {
          this.error = 'Unable to parse metrics payload.'
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
              this.connect()
              return
            }
            authFailurePause = true
            shouldReconnect = false
            this.error = 'Metrics websocket authentication failed. Sign in again, then reconnect.'
            return
          }
          scheduleReconnect(() => this.connect())
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
    resume() {
      shouldReconnect = true
      authFailurePause = false
      reconnectAttempts = 0
      this.connect()
    },
  },
})
