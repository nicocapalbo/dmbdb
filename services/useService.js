import {processRepository} from "~/services/process.js";
import {configRepository} from "~/services/config.js";
import {logsRepository} from "~/services/logs.js";
import {authRepository} from "~/services/auth.js";

export default function useService() {
  const processService = processRepository()
  const configService = configRepository()
  const logsService = logsRepository()

  return {
    processService,
    configService,
    logsService,
    authRepository
  }
}
