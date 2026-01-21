<template>
  <div class="min-h-screen flex items-center justify-center bg-slate-900 px-4">
    <div class="max-w-md w-full space-y-8">
      <!-- Logo and title -->
      <div class="text-center">
        <h1 class="text-4xl font-bold text-white mb-2">{{ projectName }} Dashboard</h1>
        <p class="text-slate-400">Sign in to continue</p>
      </div>

      <!-- Login form -->
      <div class="bg-slate-800 rounded-lg shadow-xl p-8 border border-slate-700">
        <form @submit.prevent="handleLogin" class="space-y-6">
          <!-- Username field -->
          <div>
            <label for="username" class="block text-sm font-medium text-slate-300 mb-2">
              Username
            </label>
            <input
              id="username"
              v-model="username"
              type="text"
              required
              autocomplete="username"
              class="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-md text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="Enter your username"
              :disabled="loading"
            />
          </div>

          <!-- Password field -->
          <div>
            <label for="password" class="block text-sm font-medium text-slate-300 mb-2">
              Password
            </label>
            <div class="flex items-center gap-2">
              <input
                id="password"
                v-model="password"
                :type="showPassword ? 'text' : 'password'"
                required
                autocomplete="current-password"
                class="flex-1 px-4 py-2 bg-slate-700 border border-slate-600 rounded-md text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="Enter your password"
                :disabled="loading"
              />
              <button
                type="button"
                class="px-3 py-2 bg-slate-700 border border-slate-600 rounded-md text-slate-200 hover:bg-slate-600"
                :aria-label="showPassword ? 'Hide password' : 'Show password'"
                @click="showPassword = !showPassword"
              >
                <span class="material-symbols-rounded !text-[18px]">
                  {{ showPassword ? 'visibility_off' : 'visibility' }}
                </span>
              </button>
            </div>
          </div>

          <!-- Remember me checkbox -->
          <div class="flex items-center">
            <input
              id="remember-me"
              v-model="rememberMe"
              type="checkbox"
              class="h-4 w-4 text-blue-600 focus:ring-blue-500 border-slate-600 rounded bg-slate-700"
              :disabled="loading"
            />
            <label for="remember-me" class="ml-2 block text-sm text-slate-300">
              Remember me
            </label>
          </div>

          <!-- Error message -->
          <div v-if="errorMessage" class="bg-red-900/50 border border-red-700 text-red-200 px-4 py-3 rounded-md text-sm">
            {{ errorMessage }}
          </div>

          <!-- Submit button -->
          <button
            type="submit"
            :disabled="loading"
            class="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <span v-if="!loading">Sign in</span>
            <span v-else class="flex items-center">
              <svg class="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              Signing in...
            </span>
          </button>
        </form>
      </div>

      <!-- Footer note -->
      <p class="text-center text-sm text-slate-500">
        Debrid Unlimited Media Bridge
      </p>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { useProcessesStore } from '@/stores/processes'
import { useRouter } from 'vue-router'

definePageMeta({
  layout: false, // Don't use default layout for login page
})

const router = useRouter()
const authStore = useAuthStore()
const processesStore = useProcessesStore()

// Get dynamic project name
const projectName = computed(() => processesStore.projectName)

// Form state
const username = ref('')
const password = ref('')
const rememberMe = ref(false)
const loading = ref(false)
const errorMessage = ref('')
const showPassword = ref(false)

/**
 * Handle login form submission
 */
const handleLogin = async () => {
  errorMessage.value = ''
  loading.value = true

  try {
    const success = await authStore.login(
      username.value,
      password.value,
      rememberMe.value
    )

    if (success) {
      // Redirect to home page or the page they were trying to access
      // Use window.location to force a full page reload so all stores/connections pick up the new auth tokens
      const redirectTo = router.currentRoute.value.query.redirect || '/'
      window.location.href = redirectTo
    } else {
      errorMessage.value = authStore.error || 'Login failed. Please check your credentials.'
    }
  } catch (error) {
    errorMessage.value = 'An unexpected error occurred. Please try again.'
    console.error('Login error:', error)
  } finally {
    loading.value = false
  }
}

// The middleware has already verified we need login
// We don't need to check authentication again
// Try to load processes for project name (users exist so API should work)
onMounted(async () => {
  try {
    await processesStore.getProcesses()
  } catch (err) {
    console.warn('Failed to load processes:', err)
    // Continue anyway - project name will use default 'DMB'
  }
})
</script>
