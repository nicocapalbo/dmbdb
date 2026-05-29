<script setup>
import useService from "~/services/useService.js";
import { useAuthStore } from "~/stores/auth.js";

const { processService } = useService()
const authStore = useAuthStore()
const route = useRoute()

const notices = ref([])
const loading = ref(false)
const error = ref('')
const detailsOpen = ref(false)
const pollTimer = ref(null)
const dismissedIds = ref(new Set())
const storageKey = 'dumb.updateNotices.dismissed'
const pollMs = 60000

const isAuthPage = computed(() => route.path === '/setup' || route.path === '/login')
const canLoadNotices = computed(() => !isAuthPage.value && (!authStore.isAuthEnabled || authStore.isAuthenticated))

const noticeId = (notice) => String(notice?.id || `${notice?.type || 'notice'}:${notice?.process_name || ''}:${notice?.available_version || notice?.current_version || notice?.applied_at || notice?.checked_at || ''}`)
const visibleNotices = computed(() => notices.value.filter((notice) => !dismissedIds.value.has(noticeId(notice))))
const primaryNotice = computed(() => visibleNotices.value[0] || null)
const availableCount = computed(() => visibleNotices.value.filter((notice) => notice.type === 'available').length)
const infoCount = computed(() => visibleNotices.value.filter((notice) => notice.type === 'info').length)
const appliedCount = computed(() => visibleNotices.value.filter((notice) => notice.type === 'applied').length)
const bannerTitle = computed(() => {
  if (!primaryNotice.value) return ''
  if (availableCount.value > 0) return `${availableCount.value} update${availableCount.value === 1 ? '' : 's'} available`
  if (infoCount.value > 0) return `${infoCount.value} update notice${infoCount.value === 1 ? '' : 's'}`
  if (appliedCount.value > 0) return `${appliedCount.value} update${appliedCount.value === 1 ? '' : 's'} applied`
  return 'Update notice'
})
const bannerMessage = computed(() => {
  const notice = primaryNotice.value
  if (!notice) return ''
  const name = notice.display_name || notice.process_name || 'DUMB'
  if (notice.type === 'available') {
    const version = notice.available_version ? ` ${notice.available_version}` : ''
    return `${name}${version} is ready to review.`
  }
  if (notice.type === 'applied') {
    const previous = notice.previous_version ? `${notice.previous_version} -> ` : ''
    const current = notice.current_version || notice.available_version || 'the latest version'
    return `${name} updated ${previous}${current}.`
  }
  return notice.message || `${name} has update information.`
})

const formatNoticeTime = (value) => {
  if (!value) return ''
  const numeric = Number(value)
  const date = Number.isFinite(numeric) ? new Date(numeric * 1000) : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString()
}

const loadDismissed = () => {
  if (!import.meta.client) return
  try {
    const raw = window.localStorage.getItem(storageKey)
    const parsed = raw ? JSON.parse(raw) : []
    dismissedIds.value = new Set(Array.isArray(parsed) ? parsed.map(String) : [])
  } catch {
    dismissedIds.value = new Set()
  }
}

const saveDismissed = () => {
  if (!import.meta.client) return
  try {
    window.localStorage.setItem(storageKey, JSON.stringify([...dismissedIds.value].slice(-200)))
  } catch {}
}

const normalizeNotice = (notice, type) => ({
  ...notice,
  type: notice?.type || type,
})

const loadNotices = async () => {
  if (!canLoadNotices.value || loading.value) return
  loading.value = true
  error.value = ''
  try {
    const payload = await processService.getUpdateNotices('project')
    const available = Array.isArray(payload?.available) ? payload.available.map((notice) => normalizeNotice(notice, 'available')) : []
    const info = Array.isArray(payload?.info) ? payload.info.map((notice) => normalizeNotice(notice, 'info')) : []
    const applied = Array.isArray(payload?.applied) ? payload.applied.map((notice) => normalizeNotice(notice, 'applied')) : []
    notices.value = [...available, ...info, ...applied]
  } catch (err) {
    error.value = 'Could not load update notices.'
    console.warn('Failed to load update notices:', err)
  } finally {
    loading.value = false
  }
}

const dismissNotice = (notice) => {
  dismissedIds.value.add(noticeId(notice))
  dismissedIds.value = new Set(dismissedIds.value)
  saveDismissed()
}

const dismissAll = () => {
  for (const notice of visibleNotices.value) {
    dismissedIds.value.add(noticeId(notice))
  }
  dismissedIds.value = new Set(dismissedIds.value)
  saveDismissed()
  detailsOpen.value = false
}

const openReleaseNotes = (notice) => {
  const url = notice?.release_url || notice?.repo_url
  if (!url || !import.meta.client) return
  window.open(url, '_blank', 'noopener')
}

const startPolling = () => {
  if (pollTimer.value || !import.meta.client) return
  pollTimer.value = window.setInterval(() => {
    loadNotices()
  }, pollMs)
}

const stopPolling = () => {
  if (!pollTimer.value || !import.meta.client) return
  window.clearInterval(pollTimer.value)
  pollTimer.value = null
}

onMounted(() => {
  loadDismissed()
  if (canLoadNotices.value) {
    loadNotices()
    startPolling()
  }
})

onBeforeUnmount(() => {
  stopPolling()
})

watch(canLoadNotices, (ready) => {
  if (ready) {
    loadNotices()
    startPolling()
  } else {
    stopPolling()
    notices.value = []
    detailsOpen.value = false
  }
})
</script>

<template>
  <Teleport to="body">
    <div v-if="primaryNotice" class="fixed left-1/2 top-4 z-[80] w-[min(94vw,720px)] -translate-x-1/2 px-2">
      <div class="overflow-hidden rounded-lg border border-slate-600/80 bg-slate-950/95 shadow-2xl shadow-slate-950/45 backdrop-blur">
        <div class="flex flex-col gap-3 border-l-4 border-sky-400 p-4 sm:flex-row sm:items-start">
          <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-sky-300/20 bg-sky-500/15 text-sky-100">
            <span class="material-symbols-rounded !text-[22px]">system_update_alt</span>
          </div>
          <div class="min-w-0 flex-1 space-y-1">
            <div class="flex flex-wrap items-center gap-2">
              <div class="text-sm font-semibold text-slate-50">{{ bannerTitle }}</div>
              <span
                class="rounded px-2 py-0.5 text-[11px] font-medium"
                :class="primaryNotice.type === 'available' ? 'bg-sky-500/15 text-sky-100' : primaryNotice.type === 'info' ? 'bg-violet-500/15 text-violet-100' : 'bg-emerald-500/15 text-emerald-100'"
              >
                {{ primaryNotice.type === 'available' ? 'Available' : primaryNotice.type === 'info' ? 'Info' : 'Applied' }}
              </span>
              <span v-if="visibleNotices.length > 1" class="text-[11px] text-slate-400">{{ visibleNotices.length }} total</span>
            </div>
            <div class="text-xs leading-5 text-slate-300">{{ bannerMessage }}</div>
            <div v-if="error" class="text-xs text-amber-200">{{ error }}</div>
          </div>
          <div class="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
            <button class="button-small border border-sky-300/25 hover:apply !px-3 !py-1.5 !text-xs" @click="detailsOpen = true">
              Review
            </button>
            <button
              v-if="primaryNotice.release_url || primaryNotice.repo_url"
              class="button-small border border-slate-50/15 hover:apply !px-3 !py-1.5 !text-xs"
              @click="openReleaseNotes(primaryNotice)"
            >
              {{ primaryNotice.notes_label || 'Release notes' }}
            </button>
            <button class="button-small border border-slate-50/10 hover:stop !px-3 !py-1.5 !text-xs" @click="dismissNotice(primaryNotice)">
              Dismiss
            </button>
            <button class="material-symbols-rounded ml-1 text-slate-400 hover:text-white" title="Dismiss" @click="dismissNotice(primaryNotice)">close</button>
          </div>
        </div>
      </div>
    </div>

    <div
      v-if="detailsOpen"
      class="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/85 p-3"
      @click.self="detailsOpen = false"
    >
      <div class="w-full max-w-4xl overflow-hidden rounded-lg border border-slate-700 bg-slate-950 shadow-2xl shadow-slate-950/60">
        <div class="flex items-start justify-between gap-3 border-b border-slate-800 bg-slate-900/60 px-5 py-4">
          <div class="flex gap-3">
            <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-sky-300/20 bg-sky-500/15 text-sky-100">
              <span class="material-symbols-rounded !text-[22px]">release_alert</span>
            </div>
            <div>
              <div class="text-base font-semibold text-slate-100">DUMB Updates</div>
              <div class="text-xs leading-5 text-slate-400">Review available, informational, and recently applied backend/frontend updates.</div>
            </div>
          </div>
          <button class="material-symbols-rounded text-slate-400 hover:text-white" title="Close" @click="detailsOpen = false">close</button>
        </div>
        <div class="max-h-[70vh] overflow-y-auto p-5 text-xs text-slate-300">
          <div v-if="!visibleNotices.length" class="rounded-md border border-slate-800 bg-slate-900/40 p-4 text-slate-400">
            No update notices are waiting.
          </div>
          <div v-else class="space-y-3">
            <div
              v-for="notice in visibleNotices"
              :key="noticeId(notice)"
              class="rounded-md border bg-slate-900/45 p-4"
              :class="notice.type === 'available' ? 'border-sky-400/35' : notice.type === 'info' ? 'border-violet-400/30' : 'border-emerald-400/30'"
            >
              <div class="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                <div class="min-w-0 space-y-2">
                  <div class="flex flex-wrap items-center gap-2">
                    <span class="text-sm font-semibold text-slate-100">{{ notice.display_name || notice.process_name }}</span>
                    <span
                      class="rounded px-2 py-0.5 text-[11px] font-medium"
                      :class="notice.type === 'available' ? 'bg-sky-500/15 text-sky-100' : notice.type === 'info' ? 'bg-violet-500/15 text-violet-100' : 'bg-emerald-500/15 text-emerald-100'"
                    >
                      {{ notice.type === 'available' ? 'Available' : notice.type === 'info' ? 'Info' : 'Applied' }}
                    </span>
                    <span v-if="notice.status === 'blocked'" class="rounded bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-200">Blocked</span>
                  </div>
                  <div v-if="notice.type === 'available'" class="text-slate-300">
                    Current <span class="font-medium text-slate-100">{{ notice.current_version || 'unknown' }}</span>
                    <span class="px-1 text-slate-500">-></span>
                    Available <span class="font-medium text-slate-100">{{ notice.available_version || 'unknown' }}</span>
                  </div>
                  <div v-else-if="notice.type === 'info'" class="text-slate-300">
                    Included in <span class="font-medium text-slate-100">{{ notice.current_version || 'this release' }}</span>
                  </div>
                  <div v-else class="text-slate-300">
                    Updated
                    <span v-if="notice.previous_version" class="font-medium text-slate-100">{{ notice.previous_version }}</span>
                    <span v-if="notice.previous_version" class="px-1 text-slate-500">-></span>
                    <span class="font-medium text-slate-100">{{ notice.current_version || notice.available_version || 'latest' }}</span>
                  </div>
                  <div v-if="notice.message" class="max-w-3xl leading-5 text-slate-400">{{ notice.message }}</div>
                  <div v-if="notice.reason" class="text-amber-200">{{ notice.reason }}</div>
                  <div class="text-slate-500">
                    {{ notice.type === 'applied' ? 'Applied' : notice.type === 'info' ? 'Recorded' : 'Checked' }}:
                    {{ formatNoticeTime(notice.applied_at || notice.checked_at) || 'unknown' }}
                  </div>
                </div>
                <div class="flex shrink-0 flex-wrap gap-2 md:justify-end">
                  <button
                    v-if="notice.release_url || notice.repo_url"
                    class="button-small border border-slate-50/20 hover:apply !px-3 !py-1.5 !text-xs"
                    @click="openReleaseNotes(notice)"
                  >
                    {{ notice.notes_label || 'Release notes' }}
                  </button>
                  <button class="button-small border border-slate-50/10 hover:stop !px-3 !py-1.5 !text-xs" @click="dismissNotice(notice)">
                    Dismiss
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div class="flex flex-wrap justify-end gap-2 border-t border-slate-800 bg-slate-900/40 px-5 py-4">
          <button class="button-small border border-slate-50/20 hover:apply !px-3 !py-1.5" :disabled="loading" @click="loadNotices">
            <span class="material-symbols-rounded !text-[16px]">refresh</span>
            <span>{{ loading ? 'Refreshing...' : 'Refresh' }}</span>
          </button>
          <button class="button-small border border-slate-50/10 hover:stop !px-3 !py-1.5" @click="dismissAll">Dismiss all</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
