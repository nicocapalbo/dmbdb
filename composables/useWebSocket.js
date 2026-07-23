import { useEventBus } from '@vueuse/core'
import { refreshTokenForWebSocket } from '@/services/auth'

let socket = null
let reconnectAttempts = 0
let heartbeatInterval = null
let isConnecting = false

export function useWebSocket() {
  const logBus = useEventBus('log-bus')
  console.log('[WebSocket] useWebSocket() called')

  if (socket) {
    if (socket.readyState !== WebSocket.OPEN) {
      console.log('[WebSocket] Existing socket state:', socket.readyState)
    }

    if (socket.readyState === WebSocket.OPEN) {
      return logBus
    }

    if (socket.readyState === WebSocket.CONNECTING || isConnecting) {
      console.log('[WebSocket] Still connecting... skipping duplicate init')
      return logBus
    }
  }

  console.log('[WebSocket] Creating new WebSocket...')
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'

  // Get access token from storage for authentication
  const token = localStorage.getItem('dumb_access_token') || sessionStorage.getItem('dumb_access_token')
  console.log('[WebSocket] Token found:', !!token, 'token length:', token?.length || 0)
  const websocketUrl = token
    ? `${protocol}://${window.location.host}/ws/logs?token=${encodeURIComponent(token)}`
    : `${protocol}://${window.location.host}/ws/logs`

  isConnecting = true
  const ws = new WebSocket(websocketUrl)
  socket = ws

  ws.addEventListener('open', () => {
    if (socket !== ws) {
      ws.close()
      return
    }
    isConnecting = false
    reconnectAttempts = 0
    console.log('[WebSocket] Connected')

    // Start heartbeat
    if (heartbeatInterval) clearInterval(heartbeatInterval)
    heartbeatInterval = setInterval(() => {
      if (socket === ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'ping' }))
      }
    }, 10000) // ping every 10s
  })

  ws.addEventListener('message', (event) => {
    if (socket !== ws) return
    if (event.data === 'pong') return // ignore heartbeat pongs
    logBus.emit(event.data)
  })

  ws.addEventListener('error', (error) => {
    if (socket !== ws) return
    console.error('[WebSocket] Error', error)
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
      ws.close()
    }
  })

  ws.addEventListener('close', async (event) => {
    if (socket !== ws) return
    isConnecting = false
    console.warn('[WebSocket] Disconnected.')
    socket = null
    if (event?.code === 1008) {
      const refreshed = await refreshTokenForWebSocket()
      if (refreshed) {
        reconnectAttempts = 0
        setTimeout(() => useWebSocket(), 0)
        return
      }
    }
    reconnectAttempts++
    const delay = Math.min(1000 * reconnectAttempts, 10000)
    console.warn(`[WebSocket] Reconnecting in ${delay / 1000}s...`)
    if (heartbeatInterval) clearInterval(heartbeatInterval)
    setTimeout(() => useWebSocket(), delay)
  })

  return logBus
}
