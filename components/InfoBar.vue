<script setup>
const router = useRouter()
const route = useRoute()

const toggleSettingsPage = () => {
  if (route.path === "/settings") {
    router.push({ name: 'index' })
  } else {
    router.push({ name: 'settings' })
  }
}
</script>

<template>
  <div class="w-full flex gap-2 items-center justify-end">

    <button class="w-max button-small group bg-gray-800 hover:bg-gray-700" @click="toggleSettingsPage()">
      <span
        class="material-symbols-rounded !text-[16px] rotate-0 group-hover:rotate-90 transform transition ease-in-out duration-200">settings</span>
    </button>
  </div>
</template>
