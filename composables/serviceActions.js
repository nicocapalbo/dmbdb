import useService from "@/composables/useService";

export async function performServiceAction(processName, action, successCallback) {
  const { startProcess, stopProcess, restartProcess, fetchProcessStatus } = useService();

  try {
    if (action === "start") await startProcess(processName);
    if (action === "stop") await stopProcess(processName);
    if (action === "restart") await restartProcess(processName);

    const updatedStatus = await fetchProcessStatus(processName);
    successCallback(updatedStatus);
  } catch (error) {
    console.error(`Failed to execute ${action} for process '${processName}':`, error);
    throw new Error("Failed to execute action.");
  }
}
