// https://nuxt.com/docs/api/configuration/nuxt-config
import { version } from './package.json';

export default defineNuxtConfig({
  telemetry: false,
  devServer: {
    host: process.env.NUXT_HOST || '0.0.0.0',
    port: 3005
  },
  ssr: false,
  plugins: [
    '~/plugins/websocket.js', // Added WebSocket plugin
  ],
  modules: ['@nuxtjs/tailwindcss'],
  devtools: { enabled: true },
  css: [],
  tailwindcss: {
    cssPath: '~/assets/css/main.css',
    exposeConfig: true,
  },
  components: [
    {
      path: '~/components',
      pathPrefix: false,
    }
  ],
  compatibilityDate: '2024-04-03',
  runtimeConfig: {
    public: {
      appVersion: version,
      DMB_API_URL: process.env.DMB_API_URL || "http://localhost:8000",
    },
  },
});
