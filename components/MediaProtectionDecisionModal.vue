<script setup>
import { computed } from 'vue'
import { MEDIA_PROTECTION_OVERRIDES, summarizeMediaProtection } from '~/helper/mediaProtection.js'

const props = defineProps({
  preflight: { type: Object, required: true },
  actionLabel: { type: String, default: 'continue' },
})
const emit = defineEmits(['choose', 'cancel'])
const summary = computed(() => summarizeMediaProtection(props.preflight))
const servers = computed(() => props.preflight?.media_servers || [])
</script>

<template>
  <div class="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/85 p-3" @click.self="emit('cancel')">
    <div class="w-full max-w-2xl overflow-hidden rounded-lg border border-amber-500/40 bg-slate-900 shadow-2xl">
      <div class="border-b border-slate-700 px-5 py-4">
        <h2 class="text-lg font-semibold text-amber-100">Media library protection</h2>
        <p class="mt-1 text-sm text-slate-300">
          This operation affects storage used by {{ summary.serverCount }} protected media server<span v-if="summary.serverCount !== 1">s</span>.
        </p>
      </div>

      <div class="max-h-[55vh] space-y-3 overflow-y-auto px-5 py-4">
        <div
          v-for="entry in servers"
          :key="entry.process_name"
          class="rounded border border-slate-700 bg-slate-800/50 p-3"
        >
          <div class="flex items-center justify-between gap-3">
            <span class="font-medium">{{ entry.process_name }}</span>
            <span class="rounded-full border px-2 py-0.5 text-[11px] uppercase" :class="{
              'border-rose-500/50 text-rose-200': entry.activity?.state === 'busy',
              'border-amber-500/50 text-amber-200': entry.activity?.state === 'unknown',
              'border-emerald-500/50 text-emerald-200': ['idle', 'stopped'].includes(entry.activity?.state),
            }">{{ entry.activity?.state || 'unknown' }}</span>
          </div>
          <p v-if="entry.activity?.active_sessions" class="mt-1 text-xs text-rose-200">
            {{ entry.activity.active_sessions }} active stream<span v-if="entry.activity.active_sessions !== 1">s</span>
          </p>
          <p v-if="entry.activity?.reason" class="mt-1 text-xs text-slate-400">{{ entry.activity.reason }}</p>
        </div>

        <div v-if="summary.blocked" class="rounded border border-amber-500/40 bg-amber-950/30 p-3 text-xs text-amber-100">
          Safe automation is deferred because activity is busy or could not be verified. No stream will be interrupted unless you explicitly choose <strong>Stop now</strong>.
        </div>
      </div>

      <div class="flex flex-col-reverse gap-2 border-t border-slate-700 px-5 py-4 sm:flex-row sm:flex-wrap sm:justify-end">
        <button class="button-small border border-slate-600 !px-3 !py-2" @click="emit('cancel')">
          {{ summary.blocked ? 'Defer operation' : 'Cancel' }}
        </button>
        <button
          class="button-small border border-sky-500/50 !px-3 !py-2 hover:bg-sky-900/40"
          title="Pause library scanning, leave the media server running, and continue the storage operation. Existing playback may still fail if it needs uncached data."
          @click="emit('choose', MEDIA_PROTECTION_OVERRIDES.KEEP_RUNNING)"
        >
          Keep server running
        </button>
        <button
          class="button-small border border-rose-500/50 !px-3 !py-2 hover:bg-rose-900/40"
          title="Stop the downstream media server immediately. This will interrupt active streams."
          @click="emit('choose', MEDIA_PROTECTION_OVERRIDES.STOP_NOW)"
        >
          Stop now &amp; {{ actionLabel }}
        </button>
        <button
          v-if="!summary.blocked"
          class="button-small border border-emerald-500/50 !px-3 !py-2 hover:bg-emerald-900/40"
          title="Pause scanning, stop the idle media server, perform the operation, then restore it after storage is healthy."
          @click="emit('choose', MEDIA_PROTECTION_OVERRIDES.SAFE)"
        >
          Protect &amp; {{ actionLabel }}
        </button>
      </div>
    </div>
  </div>
</template>
