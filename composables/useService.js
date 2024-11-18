import {statusRepository} from '../services/status.js'

export default function useService() {
  const statusService = statusRepository()

  return {
    statusService
  }
}
