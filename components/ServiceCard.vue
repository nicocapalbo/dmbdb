<script setup>
import useService from "~/services/useService.js";
import {PROCESS_STATUS, SERVICE_ACTIONS} from "~/constants/enums.js";
import {performServiceAction} from "~/composables/serviceActions.js";
const { processService } = useService()
const router = useRouter()
const toast = useToast()

const props = defineProps({
  process: {type: Object}
})

const status = ref(PROCESS_STATUS.UNKNOWN) // Process status
const loading = ref(false) // Loading state

const updateStatus = async () => {
  try {
    status.value = await processService.fetchProcessStatus(props.process.process_name);
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
})
</script>

<template>
  <button class="bg-gray-800 rounded-lg shadow-md p-4 flex items-center justify-between hover:bg-gray-800/70" @click="goToService">
    <span class="flex items-center gap-2">
      <span
        :class="{'bg-green-400': status === PROCESS_STATUS.RUNNING,'bg-red-400': status === PROCESS_STATUS.STOPPED,'bg-yellow-400': status === PROCESS_STATUS.UNKNOWN}"
        class="w-4 h-4 rounded-full flex-none"
      />
      <span class="text-lg font-bold">{{ process.process_name }}</span>
      <span v-if="loading" class="material-symbols-rounded !text-[22px] animate-spin">cached</span>
    </span>


    <!--ACTION BUTTONS-->
    <span class="flex items-center gap-4">
      <VTooltip>
        <button class="px-2 py-1.5 rounded bg-white/10 hover:bg-white/20" :disabled="status === PROCESS_STATUS.RUNNING || loading" @click.stop="executeAction(SERVICE_ACTIONS.START)">
          <span class="material-symbols-rounded !text-[22px] font-fill">play_arrow</span>
        </button>

        <template #popper>
          Start service
        </template>
      </VTooltip>
      <VTooltip>
        <button class="px-2 py-1.5 rounded bg-white/10 hover:bg-white/20" :disabled="status === PROCESS_STATUS.STOPPED || loading" @click.stop="executeAction(SERVICE_ACTIONS.STOP)">
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
