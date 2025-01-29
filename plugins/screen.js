import VueScreen from 'vue-screen'
export default defineNuxtPlugin(({ vueApp }) => {
  vueApp.use(VueScreen, { grid: {
      xxs: '0px',
      xs: '340px',
      sm: '640px',
      md: '768px',
      lg: '1024px',
      xl: '1280px',
      '2xl': '1536px',
      '3xl': '1920px',
      mobile: screen => (screen.xxs || screen.xs || screen.sm) && (!screen.md || screen.touch),
      large: screen => (screen.xxs || screen.xs || screen.sm || screen.md) && !screen.lg
    } })
})
