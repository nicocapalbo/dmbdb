import { createInfiniDyskV2Controller, initialInfiniDyskV2State } from '~/helper/infinidyskV2Controller.js'
import { infinidyskV2Repository } from '~/services/infinidyskV2.js'

let controller = null
export const useInfiniDyskV2State = () => {
  const state = useState('infinidysk-v2-workflows-v1', initialInfiniDyskV2State)
  if (!controller) {
    let storage = null
    try { storage = typeof window === 'undefined' ? null : window.sessionStorage } catch { /* Optional storage. */ }
    controller = createInfiniDyskV2Controller({ state, repository: infinidyskV2Repository(), storage })
  }
  return { state, ...controller }
}
