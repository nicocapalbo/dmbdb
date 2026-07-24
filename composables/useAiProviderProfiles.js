import { computed, nextTick, ref } from 'vue'

export const useAiProviderProfiles = (aiSettings, aiService) => {
  const selectedProfileId = ref('')
  const editingProfileId = ref('')
  const profileName = ref('')
  const profileBusy = ref(false)
  const profileHydrating = ref(false)
  let hydrationVersion = 0

  const profiles = computed(() =>
    Array.isArray(aiSettings.profiles) ? aiSettings.profiles : []
  )
  const profileOptions = computed(() => [
    { value: '', label: 'Unsaved provider' },
    ...profiles.value
      .map(profile => ({
        value: String(profile.id || ''),
        label: String(profile.name || profile.provider || 'Unnamed provider'),
      }))
      .sort((left, right) =>
        left.label.localeCompare(right.label, undefined, {
          sensitivity: 'base',
          numeric: true,
        })
      ),
  ])
  const selectedProfile = computed(() =>
    profiles.value.find(profile => profile.id === selectedProfileId.value) || null
  )
  const editingProfile = computed(() =>
    profiles.value.find(profile => profile.id === editingProfileId.value) || null
  )

  const syncProfileSettings = (settings) => {
    const version = ++hydrationVersion
    profileHydrating.value = true
    Object.assign(aiSettings, settings || {})
    aiSettings.api_key = ''
    selectedProfileId.value = String(aiSettings.active_profile_id || '')
    editingProfileId.value = selectedProfileId.value
    profileName.value = String(
      profiles.value.find(profile => profile.id === selectedProfileId.value)?.name || ''
    )
    nextTick(() => {
      if (version === hydrationVersion) profileHydrating.value = false
    })
    return settings
  }

  const startNewProfile = () => {
    selectedProfileId.value = ''
    editingProfileId.value = ''
    profileName.value = ''
    aiSettings.active_profile_id = ''
    aiSettings.api_key = ''
    aiSettings.api_key_configured = false
  }

  const markProfileDirty = ({ newProvider = false } = {}) => {
    if (profileHydrating.value) return false
    const selectedId = String(selectedProfileId.value || '').trim()
    const editingId = String(editingProfileId.value || '').trim()
    if (newProvider) {
      if (!selectedId && !editingId) return false
      selectedProfileId.value = ''
      editingProfileId.value = ''
      profileName.value = ''
      aiSettings.active_profile_id = ''
      aiSettings.api_key = ''
      aiSettings.api_key_configured = false
      return true
    }
    if (!selectedId) return false
    editingProfileId.value = selectedId
    selectedProfileId.value = ''
    aiSettings.active_profile_id = ''
    return true
  }

  const saveProfile = async (providerPayload) => {
    const name = String(profileName.value || '').trim()
    if (!name) throw new Error('Enter a name for this provider profile.')
    profileBusy.value = true
    try {
      const payload = {
        ...providerPayload,
        name,
      }
      const profileId = editingProfileId.value || selectedProfileId.value
      if (profileId) payload.id = profileId
      return syncProfileSettings(await aiService.saveProfile(payload))
    } finally {
      profileBusy.value = false
    }
  }

  const activateProfile = async (profileId = selectedProfileId.value) => {
    const id = String(profileId || '').trim()
    if (!id) return null
    profileBusy.value = true
    try {
      return syncProfileSettings(await aiService.activateProfile(id))
    } finally {
      profileBusy.value = false
    }
  }

  const deleteProfile = async () => {
    const id = String(selectedProfileId.value || '').trim()
    if (!id) return null
    profileBusy.value = true
    try {
      return syncProfileSettings(await aiService.deleteProfile(id))
    } finally {
      profileBusy.value = false
    }
  }

  return {
    selectedProfileId,
    editingProfileId,
    profileName,
    profileBusy,
    profileHydrating,
    profiles,
    profileOptions,
    selectedProfile,
    editingProfile,
    syncProfileSettings,
    startNewProfile,
    markProfileDirty,
    saveProfile,
    activateProfile,
    deleteProfile,
  }
}
