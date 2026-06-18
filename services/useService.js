import {processRepository} from "~/services/process.js";
import {configRepository} from "~/services/config.js";
import {logsRepository} from "~/services/logs.js";
import {authRepository} from "~/services/auth.js";
import {seerrSyncRepository} from "~/services/seerrSync.js";
import {aiRepository} from "~/services/ai.js";

export default function useService() {
  const processService = processRepository()
  const configService = configRepository()
  const logsService = logsRepository()
  const seerrSyncService = seerrSyncRepository()
  const aiService = aiRepository()

  return {
    processService,
    configService,
    logsService,
    seerrSyncService,
    aiService,
    authRepository
  }
}
