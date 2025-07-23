import { useEventBus } from '@vueuse/core'

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
  const websocketUrl = `${protocol}://${window.location.host}/ws/logs`

  isConnecting = true
  socket = new WebSocket(websocketUrl)

  const timeout = setTimeout(() => {
    if (socket.readyState !== WebSocket.OPEN) {
      console.warn('[WebSocket] Still not connected after 3s...')
      socket.close()
    }
  }, 3000)

  socket.addEventListener('open', () => {
    isConnecting = false
    reconnectAttempts = 0
    clearTimeout(timeout)
    console.log('[WebSocket] Connected')

    // Start heartbeat
    if (heartbeatInterval) clearInterval(heartbeatInterval)
    heartbeatInterval = setInterval(() => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'ping' }))
      }
    }, 10000) // ping every 10s
  })

  socket.addEventListener('message', (event) => {
    if (event.data === 'pong') return // ignore heartbeat pongs
    logBus.emit(event.data)
  })

  socket.addEventListener('error', (error) => {
    console.error('[WebSocket] Error', error)
    if (socket.readyState !== WebSocket.OPEN) {
      socket.close()
    }
  })

  socket.addEventListener('close', () => {
    isConnecting = false
    console.warn('[WebSocket] Disconnected.')
    socket = null
    reconnectAttempts++
    const delay = Math.min(3000 * reconnectAttempts, 10000)
    console.warn(`[WebSocket] Reconnecting in ${delay / 1000}s...`)
    if (heartbeatInterval) clearInterval(heartbeatInterval)
    setTimeout(() => useWebSocket(), delay)
  })

  return logBus
}