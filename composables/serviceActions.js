import useService from "~/services/useService.js"

export async function performServiceAction(processName, action, successCallback) {
  const { processService } = useService()

  try {
    if (action === "start") await processService.startProcess(processName)
    if (action === "stop") await processService.stopProcess(processName)
    if (action === "restart") await processService.restartProcess(processName)

    const updatedStatus = await processService.fetchProcessStatus(processName)
    successCallback(updatedStatus)
  } catch (error) {
    console.error(`Failed to execute ${action} for process '${processName}':`, error)
    throw new Error("Failed to execute action.")
  }
}
