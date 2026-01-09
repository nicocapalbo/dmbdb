<script setup>
import { ref, computed, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useWebSocket } from '~/composables/useWebSocket.js'
import SelectComponent from '~/components/SelectComponent.vue'
import { useProcessesStore } from '~/stores/processes.js'
import { useLogsStore } from '~/stores/logs.js'
import { logsParser } from '~/helper/logsParser.js'
import { useOnboardingStore } from '~/stores/onboarding.js'
import { useUiStore } from '~/stores/ui.js'
import { formatTimestamp } from '~/helper/formatTimestamp.js'

const processesStore = useProcessesStore()
const logsStore = useLogsStore()
const store = useOnboardingStore()
const uiStore = useUiStore()
const projectName = computed(() => processesStore.projectName)
const rawLogs = ref([])
const parsedLogs = ref([])
const logContainer = ref(null)
const filterText = ref('')
const selectedLevelFilter = ref('')
const selectedProcessFilter = ref('')
const maxLength = ref(1000)
const isPaused = ref(false)
const downloadLogs = ref(false)
let logIdCounter = 0
let logBus
const buffer = []
const flushThreshold = 100
const flushInterval = 50
let lastFlush = Date.now()
let flushTimer
const levelItems = [
    { value: '', label: 'All Logs' },
    { value: 'INFO', label: 'Info' },
    { value: 'DEBUG', label: 'Debug' },
    { value: 'ERROR', label: 'Error' },
    { value: 'WARNING', label: 'Warning' }
]

const processItems = computed(() => {
    const processes = [...new Set(parsedLogs.value.map(log => log.process).filter(Boolean))]
    return [{ value: '', label: 'All Processes' }, ...processes.map(p => ({ value: p, label: p }))]
})

function flushLogs() {
    if (isPaused.value || buffer.length === 0) return

    const now = Date.now()
    if (buffer.length >= flushThreshold || now - lastFlush >= flushInterval) {
        const entries = logsParser(buffer.splice(0, buffer.length)) || []
        entries.forEach(entry => {
            if (!entry) return
            parsedLogs.value.push({ ...entry, id: logIdCounter++ })
            if (parsedLogs.value.length > maxLength.value) {
                parsedLogs.value.splice(0, parsedLogs.value.length - maxLength.value)
            }
        })
        lastFlush = now
        nextTick(() => scrollToBottom())
    }
}

function scrollToBottom() {
    if (!logContainer.value || isPaused.value) return
    logContainer.value.scrollTop = logContainer.value.scrollHeight
}

const filteredLogs = computed(() => {
    return parsedLogs.value.filter(log => {
        const matchesText = log.message.toLowerCase().includes(filterText.value.toLowerCase())
        const matchesLevel = !selectedLevelFilter.value || log.level === selectedLevelFilter.value
        const matchesProcess = !selectedProcessFilter.value || log.process === selectedProcessFilter.value
        return matchesText && matchesLevel && matchesProcess
    })
})

const formatLogTimestamp = (value) => formatTimestamp(value, uiStore.logTimestampFormat)

onMounted(() => {
    console.log('[StepLogs] onMounted')
    uiStore.loadLogTimestampFormat()
    logBus = useWebSocket()
    console.log('[StepLogs] useWebSocket() returned', logBus)
    logBus.on((msg) => {
        if (Array.isArray(msg)) {
            buffer.push(...msg)
        } else {
            buffer.push(msg)
        }
        flushLogs()
    })

    flushTimer = setInterval(flushLogs, flushInterval)
})

onBeforeUnmount(() => {
    logBus.reset()
    clearInterval(flushTimer)
})

function downloadOnboardingLog() {
  const blob = new Blob(
    [parsedLogs.value.map(log => `${formatLogTimestamp(log.timestamp)} [${log.level}] ${log.process}: ${log.message}`).join('\n')],
    { type: 'text/plain' }
  )
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'onboarding.log'
  a.click()
  URL.revokeObjectURL(url)
}

watch(() => store.step, (newStep) => {
  if (
    (newStep === store.successStep || newStep === store.errorStep) &&
    downloadLogs.value
  ) {
    downloadOnboardingLog()
  }
})

</script>

<template>
  <div class="flex flex-col gap-2" style="height: 70vh;">
    <!-- Controls -->
    <div class="flex gap-2 items-center shrink-0">
      <SelectComponent
        v-model="selectedLevelFilter"
        :items="levelItems"
        placeholder="Filter Level"
        class="w-32"
      />
      <SelectComponent
        v-model="selectedProcessFilter"
        :items="processItems"
        placeholder="Filter Process"
        class="w-40"
      />
      <input
        v-model="filterText"
        type="text"
        placeholder="Search logs..."
        class="input input-bordered w-full"
      />
      <button class="btn" @click="isPaused = !isPaused">
        {{ isPaused ? 'Resume' : 'Pause' }}
      </button>
    </div>

    <!-- Download Logs Toggle -->
    <div class="mt-4 flex items-center space-x-2">
      <input type="checkbox" id="downloadLogs" v-model="downloadLogs" class="h-4 w-4 text-blue-600" />
      <label for="downloadLogs" class="text-sm text-gray-300">Automatically download onboarding log?</label>
    </div>

    <!-- Scrollable log area -->
    <div class="flex-1 min-h-0 overflow-hidden">
      <div
        ref="logContainer"
        class="bg-black text-white p-2 rounded h-full overflow-y-auto text-sm font-mono leading-snug"
      >
        <div v-for="log in filteredLogs" :key="log.id">
          <span class="text-gray-500">{{ formatLogTimestamp(log.timestamp) }}</span>
          <span class="mx-1 font-bold" :class="{
            'text-green-400': log.level === 'INFO',
            'text-yellow-400': log.level === 'WARNING',
            'text-red-400': log.level === 'ERROR',
            'text-gray-400': log.level === 'DEBUG'
          }">[{{ log.level }}]</span>
          <span class="text-purple-300">{{ log.process }}</span>:
          <span>{{ log.message }}</span>
        </div>
      </div>
    </div>
  </div>
</template>
