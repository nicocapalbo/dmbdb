export const INFINIDYSK_V2_INVITATION_STORAGE_KEY = 'dumb.infinidyskV2.upgradeInvitation.v1'

export const infinidyskV2UpgradeInvitationAvailable = (status, enabledProcesses) => status?.runtime_generation === '1'
  && status?.mode === 'migrate' && status?.eligibility?.ready === true
  && Array.isArray(enabledProcesses) && enabledProcesses.some(service => service?.config_key === 'infinidysk'
    && (service?.config?.enabled === true || service?.config?.enabled === 'true')
    && service.config.runtime_generation !== '2' && service.config.runtime_generation !== 2)

export const normalizeInfiniDyskV2InvitationPreference = value => {
  const preference = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  const dismissed = preference.dismissed === true
  const snoozedUntil = !dismissed && typeof preference.snoozedUntil === 'number'
    && Number.isFinite(preference.snoozedUntil) && preference.snoozedUntil > 0 ? preference.snoozedUntil : 0
  return { dismissed, snoozedUntil }
}

const validClock = value => typeof value === 'number' && Number.isFinite(value) && value >= 0

export const infinidyskV2InvitationDue = (value, nowSeconds = Date.now() / 1000) => {
  const preference = normalizeInfiniDyskV2InvitationPreference(value)
  return !preference.dismissed && validClock(nowSeconds) && nowSeconds >= preference.snoozedUntil
}

export const deferInfiniDyskV2Invitation = (value, durationSecondsOrPermanent, nowSeconds = Date.now() / 1000) => {
  if (durationSecondsOrPermanent === 'permanent') return { dismissed: true, snoozedUntil: 0 }
  if (typeof durationSecondsOrPermanent !== 'number' || !Number.isFinite(durationSecondsOrPermanent)
    || durationSecondsOrPermanent <= 0 || !validClock(nowSeconds)
    || !Number.isFinite(nowSeconds + durationSecondsOrPermanent)) return normalizeInfiniDyskV2InvitationPreference(value)
  return { dismissed: false, snoozedUntil: nowSeconds + durationSecondsOrPermanent }
}
