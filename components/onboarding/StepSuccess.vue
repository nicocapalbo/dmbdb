<script setup>
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useOnboardingStore } from '~/stores/onboarding.js'

const router = useRouter()
const store = useOnboardingStore()

onMounted(async () => {
    try {
        await store.check()
    } catch (err) {
        console.error('Onboarding status check failed:', err)
    }
    setTimeout(() => {
        router.replace('/')
    }, 2000)
})
</script>

<template>
    <section class="bg-gray-900 flex justify-center py-12 px-4">
        <div class="w-full max-w-2xl bg-gray-800 rounded-2xl shadow-lg p-8 space-y-6 text-center">
            <h2 class="text-2xl font-bold text-green-400">
                All set! 🎉
            </h2>
            <p class="text-gray-300 mb-2">
                Your services are launching. You’ll be redirected shortly.
            </p>
        </div>
    </section>
</template>
