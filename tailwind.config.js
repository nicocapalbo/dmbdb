/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './components/**/*.{js,vue,ts}',
    './layouts/**/*.vue',
    './pages/**/*.vue',
    './app.vue',
    './error.vue',
  ],
  theme: {
    extend: {
      colors: {
        primary: '#2DBA4E',
        secondary: '#24292E',
        dark: '#2B3137',
        light: '#FAFBFC',
        white: '#FFFFFF',
        teal: '#276D6C',
        mint: '#52DBBD',
        softGreen: '#88ab98',
        gold: '#f2c35c',
        brown: '#a67b40',
        charcoal: '#36373a',
        orange: '#f0440a',
        lavender: '#dcacf2',
        lime: '#cef2ac',
        cyan: '#55d0db',
        sky: '#b1e8fd',
      },
    },
  },
  plugins: [],
}

