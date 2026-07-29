import {
  clearUiServiceContextCookie,
  shouldClearUiServiceContext,
} from '~/helper/uiServiceContext.js'

export default defineNuxtPlugin(() => {
  const route = useRoute()
  const router = useRouter()

  if (shouldClearUiServiceContext(route)) {
    clearUiServiceContextCookie()
  }

  router.beforeEach((to, from) => {
    if (shouldClearUiServiceContext(to, from)) {
      clearUiServiceContextCookie()
    }
  })
})
