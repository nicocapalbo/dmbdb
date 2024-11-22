import { useEventBus } from '@vueuse/core';

export default defineNuxtPlugin((nuxtApp) => {
  // Determine WebSocket protocol based on current protocol
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';

  // Always connect to the backend on localhost:8000
  const websocketUrl = `${protocol}://127.0.0.1:8000/ws/logs`; // Backend WebSocket URL
  const socket = new WebSocket(websocketUrl);

  const logBus = useEventBus('log-bus'); // Initialize the event bus

  socket.onopen = () => console.log('WebSocket connection established.');

  socket.onmessage = (event) => {
    console.log('WebSocket message received:', event.data); // Debug log
    logBus.emit(event.data); // Emit raw data to the event bus
  };

  socket.onerror = (error) => console.error('WebSocket error:', error);
  socket.onclose = () => console.log('WebSocket connection closed.');

  nuxtApp.provide('socket', socket); // Inject the WebSocket instance into Nuxt's context
});
