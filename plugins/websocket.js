import { useEventBus } from '@vueuse/core';

export default defineNuxtPlugin((nuxtApp) => {
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const websocketUrl = `${protocol}://${window.location.host}/ws/logs`; // Relative path
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
