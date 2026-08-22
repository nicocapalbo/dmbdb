const initialInfiniDyskMigrationState = () => ({
  migrationCapability: null,
  migrationJobsCapability: null,
  statusResolved: false,
  jobResolved: false,
  migration: null,
  job: null,
  error: '',
})

export const useInfiniDyskMigrationState = () => {
  const state = useState('infinidysk-namespace-migration-state', initialInfiniDyskMigrationState)

  const update = (changes = {}) => {
    state.value = { ...state.value, ...changes }
  }

  const reset = () => {
    state.value = initialInfiniDyskMigrationState()
  }

  return { state, update, reset }
}
