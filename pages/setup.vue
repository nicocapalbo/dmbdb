<template>
  <div class="min-h-screen flex items-center justify-center bg-slate-900 px-4">
    <div class="max-w-md w-full space-y-8">
      <!-- Logo and title -->
      <div class="text-center">
        <h1 class="text-4xl font-bold text-white mb-2">Welcome to your {{ projectName }} Dashboard</h1>
        <p class="text-slate-400">Create your administrator account</p>
      </div>

      <!-- Setup form -->
      <div class="bg-slate-800 rounded-lg shadow-xl p-8 border border-slate-700">
        <div class="mb-6 bg-blue-900/30 border border-blue-700/50 rounded-lg p-4">
          <div class="flex items-start gap-3">
            <span class="material-symbols-rounded text-blue-400 text-xl">info</span>
            <div class="text-sm text-blue-200">
              <p class="font-semibold mb-1">First Time Setup</p>
              <p class="text-blue-300">
                Create your first administrator account to enable authentication.
                This will secure access to your {{ projectName }} Dashboard.
              </p>
            </div>
          </div>
        </div>

        <form @submit.prevent="handleSetup" class="space-y-6">
          <!-- Username field -->
          <div>
            <label for="username" class="block text-sm font-medium text-slate-300 mb-2">
              Username <span class="text-red-400">*</span>
            </label>
            <input
              id="username"
              v-model="username"
              type="text"
              required
              autocomplete="username"
              minlength="3"
              class="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-md text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="Choose a username (min 3 characters)"
              :disabled="loading"
            />
            <p class="mt-1 text-xs text-slate-400">Minimum 3 characters</p>
          </div>

          <!-- Password field -->
          <div>
            <label for="password" class="block text-sm font-medium text-slate-300 mb-2">
              Password <span class="text-red-400">*</span>
            </label>
            <input
              id="password"
              v-model="password"
              type="password"
              required
              autocomplete="new-password"
              minlength="8"
              maxlength="72"
              class="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-md text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="Choose a strong password (min 8 characters)"
              :disabled="loading"
            />
            <p class="mt-1 text-xs text-slate-400">8-72 characters</p>
          </div>

          <!-- Confirm Password field -->
          <div>
            <label for="confirmPassword" class="block text-sm font-medium text-slate-300 mb-2">
              Confirm Password <span class="text-red-400">*</span>
            </label>
            <input
              id="confirmPassword"
              v-model="confirmPassword"
              type="password"
              required
              autocomplete="new-password"
              minlength="8"
              maxlength="72"
              class="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-md text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="Re-enter your password"
              :disabled="loading"
            />
          </div>

          <!-- Error message -->
          <div v-if="errorMessage" class="bg-red-900/50 border border-red-700 text-red-200 px-4 py-3 rounded-md text-sm">
            {{ errorMessage }}
          </div>

          <!-- Submit button -->
          <button
            type="submit"
            :disabled="loading || !isFormValid"
            class="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <span v-if="!loading">Create Account & Enable Authentication</span>
            <span v-else class="flex items-center">
              <svg class="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              Creating account...
            </span>
          </button>

          <!-- Skip button -->
          <button
            type="button"
            @click="handleSkip"
            :disabled="loading"
            class="w-full flex justify-center py-2 px-4 border border-slate-600 rounded-md shadow-sm text-sm font-medium text-slate-300 bg-slate-800 hover:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-slate-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Skip - Continue Without Authentication
          </button>
        </form>
      </div>

      <!-- Security note -->
      <div class="text-center text-xs text-slate-500 space-y-1">
        <p>This account will have full administrative access.</p>
        <p>Keep your credentials secure and use a strong password.</p>
        <p class="text-slate-600">You can enable authentication later from Settings.</p>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { useProcessesStore } from '@/stores/processes'
import { useRouter } from 'vue-router'

definePageMeta({
  layout: false, // Don't use default layout for setup page
})

const router = useRouter()
const authStore = useAuthStore()
const processesStore = useProcessesStore()

// Get dynamic project name
const projectName = computed(() => processesStore.projectName)

// Form state
const username = ref('')
const password = ref('')
const confirmPassword = ref('')
const loading = ref(false)
const errorMessage = ref('')

// Form validation
const isFormValid = computed(() => {
  return (
    username.value.length >= 3 &&
    password.value.length >= 8 &&
    password.value === confirmPassword.value
  )
})

/**
 * Handle setup form submission
 */
const handleSetup = async () => {
  errorMessage.value = ''

  // Validate passwords match
  if (password.value !== confirmPassword.value) {
    errorMessage.value = 'Passwords do not match'
    return
  }

  // Validate username length
  if (username.value.length < 3) {
    errorMessage.value = 'Username must be at least 3 characters long'
    return
  }

  // Validate password length
  if (password.value.length < 8) {
    errorMessage.value = 'Password must be at least 8 characters long'
    return
  }

  if (password.value.length > 72) {
    errorMessage.value = 'Password cannot be longer than 72 characters'
    return
  }

  loading.value = true

  try {
    const success = await authStore.setup(username.value, password.value)

    if (success) {
      // Redirect to home page after successful setup
      router.push('/')
    } else {
      errorMessage.value = authStore.error || 'Setup failed. Please try again.'
    }
  } catch (error) {
    errorMessage.value = 'An unexpected error occurred. Please try again.'
    console.error('Setup error:', error)
  } finally {
    loading.value = false
  }
}

/**
 * Handle skip setup - continue without authentication
 */
const handleSkip = async () => {
  errorMessage.value = ''
  loading.value = true

  try {
    const success = await authStore.skipSetup()

    if (success) {
      // Redirect to home page after skipping setup
      router.push('/')
    } else {
      errorMessage.value = authStore.error || 'Failed to skip setup. Please try again.'
    }
  } catch (error) {
    errorMessage.value = 'An unexpected error occurred. Please try again.'
    console.error('Skip setup error:', error)
  } finally {
    loading.value = false
  }
}

// The middleware has already verified we need setup (no users exist)
// We don't need to call checkAuthStatus() again or load processes yet
// The project name will use the default 'DMB' until auth is set up
onMounted(async () => {
  // No additional checks needed - middleware already verified we need setup
})
</script>
