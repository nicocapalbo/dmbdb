<script setup>
import { computed, inject, onMounted, onUnmounted, ref, watch } from 'vue'
import { routeLocationKey } from 'vue-router'
import { readSettingsSectionChoice, settingsSectionHashMatches, settingsSectionStorageKey, writeSettingsSectionChoice } from '~/helper/settingsSections.js'

const props = defineProps({ sectionId: { type: String, required: true }, title: { type: String, required: true }, description: { type: String, default: '' } })
const route = inject(routeLocationKey, null)
const userOpen = ref(false)
const navigationOpen = ref(false)
const isOpen = computed(() => userOpen.value || navigationOpen.value)
const contentId = computed(() => `settings-section-${props.sectionId}`)
const storage = () => { try { return typeof window === 'undefined' ? null : window.localStorage } catch { return null } }
const applyHash = hash => { navigationOpen.value = settingsSectionHashMatches(hash, props.sectionId) }
const toggle = () => {
  const open = !isOpen.value
  navigationOpen.value = false
  userOpen.value = open
  writeSettingsSectionChoice(storage(), props.sectionId, open)
}
const hashChanged = () => applyHash(route?.hash || window.location.hash)
const storageChanged = event => { if (event.key === settingsSectionStorageKey(props.sectionId) || event.key === null) userOpen.value = readSettingsSectionChoice(storage(), props.sectionId) }
watch(() => route?.hash, value => applyHash(value || ''))
onMounted(() => {
  userOpen.value = readSettingsSectionChoice(storage(), props.sectionId)
  hashChanged()
  window.addEventListener('hashchange', hashChanged)
  window.addEventListener('storage', storageChanged)
})
onUnmounted(() => { window.removeEventListener('hashchange', hashChanged); window.removeEventListener('storage', storageChanged) })
</script>

<template>
  <section :id="sectionId" :data-testid="`settings-section-${sectionId}`">
    <div class="settings-section-heading" :class="isOpen ? 'mb-6' : ''">
      <button type="button" class="settings-section-toggle" :aria-expanded="isOpen" :aria-controls="contentId" @click="toggle">
        <span class="min-w-0"><span class="block text-2xl font-medium sm:text-3xl">{{ title }}</span><span v-if="description" class="settings-section-description mt-1 block text-sm">{{ description }}</span></span>
        <span class="material-symbols-rounded settings-section-description shrink-0 transition-transform" :class="isOpen ? 'rotate-180' : ''" aria-hidden="true">expand_more</span>
      </button>
    </div>
    <div v-show="isOpen" :id="contentId"><slot /></div>
  </section>
</template>

<style scoped>
.settings-section-heading { @apply w-full border-b pb-3; border-color: var(--app-border); }
.settings-section-toggle { @apply flex w-full items-center justify-between gap-4 rounded-md px-1 py-1 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500; color: var(--app-text); }
.settings-section-toggle:hover { background: var(--app-bg-soft); }
.settings-section-description { color: var(--app-text-muted); }
</style>
