import { defineStore } from 'pinia'

let socket = null
let reconnectTimer = null
let reconnectAttempts = 0
let isConnecting = false
let shouldReconnect = true
let connectTimer = null

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
  return `${protocol}://${window.location.host}/ws/metrics?${params.toString()}`
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

export const useMetricsStore = defineStore('metrics', {
  state: () => ({
    latestSnapshot: null,
    historyItems: [],
    historySeries: null,
    historyTimestamps: [],
    historyTruncated: false,
    historyStats: null,
    status: 'disconnected',
    error: null,
  }),
  actions: {
    connect() {
      if (!process.client) return
      if (!shouldReconnect) return
      if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
        return
      }
      if (isConnecting) return

      isConnecting = true
      this.status = 'connecting'
      this.error = null

      socket = new WebSocket(buildUrl())

      if (connectTimer) clearTimeout(connectTimer)
      connectTimer = setTimeout(() => {
        if (socket && socket.readyState !== WebSocket.OPEN) {
          socket.close()
          isConnecting = false
          this.status = 'disconnected'
          if (shouldReconnect) {
            scheduleReconnect(() => this.connect())
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
          if (payload?.type === 'bootstrap') {
            if (payload.snapshot) {
              this.latestSnapshot = payload.snapshot
            }
            this.historyItems = Array.isArray(payload.items) ? payload.items : []
            this.historySeries = payload.series || null
            this.historyTimestamps = Array.isArray(payload.timestamps) ? payload.timestamps : []
            this.historyTruncated = Boolean(payload.truncated)
            this.historyStats = payload.stats || null
            return
          }
          if (payload?.type === 'history') {
            this.historyItems = Array.isArray(payload.items) ? payload.items : []
            this.historySeries = null
            this.historyTimestamps = this.historyItems.map((item) => item.timestamp)
            this.historyTruncated = Boolean(payload.truncated)
            this.historyStats = null
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
          scheduleReconnect(() => this.connect())
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
    resume() {
      shouldReconnect = true
      this.connect()
    },
  },
})
