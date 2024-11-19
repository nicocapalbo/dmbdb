// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  devServer: {
    port: 3005
  },
  ssr: false,
  modules: ['@nuxtjs/tailwindcss'],
  devtools: { enabled: true },
  // css: ['assets/css/global.scss','floating-vue/dist/style.css', 'animate.css/animate.min.css'],
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
})
