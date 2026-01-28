<script setup>
import useService from "~/services/useService.js";
import { useStatusStore } from "~/stores/status.js";
import {PROCESS_STATUS, SERVICE_ACTIONS} from "~/constants/enums.js";
import {performServiceAction} from "~/composables/serviceActions.js";
import { extractRestartInfo } from "~/helper/restartInfo.js";
import { useConfigStore } from "~/stores/config.js";

const { processService } = useService()
const router = useRouter()
const toast = useToast()
const statusStore = useStatusStore()
const configStore = useConfigStore()

const props = defineProps({
  process: {type: Object}
})

const status = ref(PROCESS_STATUS.UNKNOWN) // Process status
const health = ref(null)
const healthReason = ref(null)
const restartInfo = ref(null)
const autoRestartAllowed = ref(false)
const loading = ref(false) // Loading state
const liveStatusEntry = computed(() => statusStore.statusByName?.[props.process?.process_name])
const displayStatus = computed(() => liveStatusEntry.value?.status ?? status.value)
const displayHealth = computed(() => {
  if (typeof liveStatusEntry.value?.healthy === 'boolean') return liveStatusEntry.value.healthy
  return health.value
})
const displayHealthReason = computed(() => liveStatusEntry.value?.health_reason ?? healthReason.value)
const displayRestart = computed(() => liveStatusEntry.value?.restart ?? restartInfo.value)
const normalizeName = (value) => String(value || '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '')
const isApiService = computed(() => {
  const name = normalizeName(props.process?.process_name)
  return name === 'dumbapi' || name === 'dmbapi'
})
const showServiceControls = computed(() => !isApiService.value)
const statusDotClass = computed(() => {
  if (displayStatus.value === PROCESS_STATUS.RUNNING) {
    return displayHealth.value === false ? 'bg-amber-400' : 'bg-green-400'
  }
  if (displayStatus.value === PROCESS_STATUS.STOPPED) return 'bg-red-400'
  return 'bg-yellow-400'
})
const statusTitle = computed(() => {
  if (displayHealth.value === false && displayHealthReason.value) return displayHealthReason.value
  if (displayHealth.value === true) return 'Healthy'
  return `Status: ${displayStatus.value}`
})

const pickRestartStat = (stats, keys) => {
  if (!stats || typeof stats !== 'object') return null
  for (const key of keys) {
    if (stats[key] != null) return stats[key]
  }
  return null
}

const toNumber = (value) => {
  if (typeof value === 'number') return value
  if (typeof value === 'string' && value.trim().length) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

const formatRestartTime = (value) => {
  if (value == null) return null
  if (typeof value === 'string' && !value.trim()) return null
  const numeric = typeof value === 'number' || typeof value === 'string' ? Number(value) : null
  if (Number.isFinite(numeric)) {
    const ts = numeric < 1e12 ? numeric * 1000 : numeric
    return new Date(ts).toLocaleString()
  }
  const parsed = new Date(value)
  if (!Number.isNaN(parsed.getTime())) return parsed.toLocaleString()
  return null
}

const restartStats = computed(() => {
  const info = displayRestart.value
  if (!info || typeof info !== 'object') return null
  return info.stats || info.restart_stats || info.counters || null
})

const restartEnabledFlag = computed(() => {
  const info = displayRestart.value
  if (!info || typeof info !== 'object') return null
  if (typeof info.enabled === 'boolean') return info.enabled
  if (typeof info.disabled === 'boolean') return !info.disabled
  return null
})

const restartCount = computed(() => {
  const value = pickRestartStat(restartStats.value, [
    'total_restarts',
    'total',
    'count',
    'restarts',
    'restart_attempts',
    'restart_successes',
  ])
  const number = toNumber(value)
  return Number.isFinite(number) ? number : null
})

const restartWindow = computed(() => {
  const value = pickRestartStat(restartStats.value, [
    'window_restarts',
    'window',
    'recent',
    'window_count',
    'recent_restart_attempts',
  ])
  const number = toNumber(value)
  return Number.isFinite(number) ? number : null
})

const unhealthyCount = computed(() => {
  const value = pickRestartStat(restartStats.value, ['unhealthy_count', 'unhealthy'])
  const number = toNumber(value)
  return Number.isFinite(number) ? number : null
})

const unhealthyThreshold = computed(() => {
  const value = pickRestartStat(restartStats.value, ['unhealthy_threshold', 'unhealthy_limit', 'unhealthy_max'])
  const number = toNumber(value)
  return Number.isFinite(number) ? number : null
})

const restartTitle = computed(() => {
  if (restartCount.value == null) return null
  const parts = [`Restarts: ${restartCount.value}`]
  if (restartWindow.value != null) parts.push(`Window: ${restartWindow.value}`)
  if (unhealthyCount.value != null && unhealthyThreshold.value != null) {
    parts.push(`Unhealthy: ${unhealthyCount.value}/${unhealthyThreshold.value}`)
  }
  const last = formatRestartTime(
    pickRestartStat(restartStats.value, ['last_restart', 'last_restart_at', 'last_restart_ts', 'last_restart_time'])
  )
  if (last) parts.push(`Last: ${last}`)
  const reason = pickRestartStat(restartStats.value, [
    'last_exit_reason',
    'last_failure_reason',
    'last_reason',
    'last_trigger',
  ])
  if (reason) parts.push(`Reason: ${reason}`)
  return parts.join(' • ')
})

const showRestartBadge = computed(() => {
  if (restartCount.value == null) return false
  return autoRestartAllowed.value === true
})

const resolveAutoRestartAllowed = async () => {
  const policy = await configStore.getAutoRestartPolicy()
  const name = props.process?.process_name
  if (!policy || policy.enabled !== true || !name) {
    autoRestartAllowed.value = false
    return
  }
  const services = Array.isArray(policy.services) ? policy.services : []
  autoRestartAllowed.value = services.some((entry) => entry?.process_name === name)
}

const updateStatus = async () => {
  try {
    const data = await processService.fetchProcessStatusDetails(props.process.process_name, { includeHealth: true })
    status.value = data.status
    health.value = data.healthy
    healthReason.value = data.health_reason
    restartInfo.value = extractRestartInfo(data)
  } catch (e) {
    console.error("Failed to get process status:", e);
  }
}
const executeAction = async (selectedAction) => {
  loading.value = true; // Start loading spinner
  status.value = PROCESS_STATUS.UNKNOWN
  try {

    await performServiceAction(props.process.process_name, selectedAction, (processResponse) => {
      updateStatus()
      toast.success({ title: 'Success!', message: `${processResponse.process_name} ${processResponse.status}` })
    })
  } catch (err) {
    console.error(`Failed to execute action: ${err.message}`);
    toast.error({ title: 'Error!', message: "An error occurred while performing the action." })
  } finally {
    loading.value = false; // Stop loading spinner
  }
}

const goToService = () => {
  router.push({name: 'services-serviceId', params: { serviceId: props.process.process_name}})
}

onMounted(() => {
  updateStatus();
  resolveAutoRestartAllowed();
})

watch(() => props.process?.process_name, () => {
  resolveAutoRestartAllowed();
})
</script>

<template>
  <button class="bg-gray-800 rounded-lg shadow-md p-2 md:p-4 flex items-center justify-between hover:bg-gray-800/70" @click="goToService">
    <span class="flex items-center gap-1.5 md:gap-2">
      <span
        :class="statusDotClass"
        :title="statusTitle"
        class="w-3 h-3 md:w-4 md:h-4 rounded-full flex-none"
      />
      <span class="text-sm md:text-lg font-bold">{{ process.process_name }}</span>
      <span
        v-if="showRestartBadge"
        class="text-[10px] md:text-[11px] px-1.5 py-0.5 rounded-full border border-slate-600/60 bg-slate-700/40 text-slate-200"
        :title="restartTitle || ''"
      >
        R {{ restartCount }}
      </span>
      <span v-if="loading" class="material-symbols-rounded !text-[22px] animate-spin">cached</span>
    </span>


    <!--ACTION BUTTONS-->
    <span v-if="showServiceControls" class="flex items-center gap-4">
      <VTooltip>
        <button class="px-2 py-1.5 rounded bg-white/10 hover:bg-white/20" :disabled="displayStatus === PROCESS_STATUS.RUNNING || loading" @click.stop="executeAction(SERVICE_ACTIONS.START)">
          <span class="material-symbols-rounded !text-[22px] font-fill">play_arrow</span>
        </button>

        <template #popper>
          Start service
        </template>
      </VTooltip>
      <VTooltip>
        <button class="px-2 py-1.5 rounded bg-white/10 hover:bg-white/20" :disabled="displayStatus === PROCESS_STATUS.STOPPED || loading" @click.stop="executeAction(SERVICE_ACTIONS.STOP)">
          <span class="material-symbols-rounded !text-[22px] font-fill">stop</span>
        </button>

        <template #popper>
          Stop service
        </template>
      </VTooltip>
      <VTooltip>
        <button class="px-2 py-1.5 rounded bg-white/10 hover:bg-white/20" :disabled="loading" @click.stop="executeAction(SERVICE_ACTIONS.RESTART)">
          <span class="material-symbols-rounded !text-[22px] font-fill">refresh</span>
        </button>

        <template #popper>
          Restart service
        </template>
      </VTooltip>
    </span>
  </button>
</template>
