import { useEventBus } from '@vueuse/core';

export default defineNuxtPlugin((nuxtApp) => {
  const logBus = useEventBus('log-bus');

  function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const websocketUrl = `${protocol}://${window.location.host}/ws/logs`;

    console.log('[WebSocket] Connecting to:', websocketUrl);
    const socket = new WebSocket(websocketUrl);

    socket.onopen = () => console.log('WebSocket connection established.');

    socket.onmessage = (event) => {
      console.log('WebSocket message received:', event.data);
      logBus.emit(event.data);
    };

    socket.onerror = (error) => console.error('WebSocket error:', error);

    socket.onclose = () => {
      console.warn('WebSocket disconnected. Reconnecting in 3s...');
      setTimeout(connectWebSocket, 3000); // Auto-reconnect after 3s
    };

    nuxtApp.provide('socket', socket);
  }

  connectWebSocket();
});
