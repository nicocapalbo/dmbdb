import useService from "~/services/useService.js"
import {SERVICE_ACTIONS} from "~/constants/enums.js";

export async function performServiceAction(processName, action, successCallback) {
  const { processService } = useService()

  try {
    let processResponse
    if (action === SERVICE_ACTIONS.START) processResponse =  await processService.startProcess(processName)
    if (action === SERVICE_ACTIONS.STOP) processResponse =  await processService.stopProcess(processName)
    if (action === SERVICE_ACTIONS.RESTART) processResponse =  await processService.restartProcess(processName)
    successCallback(processResponse)
  } catch (error) {
    console.error(`Failed to execute ${action} for process '${processName}':`, error)
    throw new Error("Failed to execute action.")
  }
}
