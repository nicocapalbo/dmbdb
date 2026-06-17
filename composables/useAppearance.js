import {
  SYSTEM_APPEARANCE_THEME,
  appearanceThemeIds,
  getAppearanceTheme,
} from '~/helper/appearanceThemes.js'

const storageKey = 'dmbdb.appearance.theme'
const selectedTheme = ref(SYSTEM_APPEARANCE_THEME)
let mediaQuery = null
let initialized = false

const getSystemMode = () => {
  if (!import.meta.client || !window.matchMedia) return 'dark'
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

const getResolvedThemeId = (themeId) => {
  if (themeId !== SYSTEM_APPEARANCE_THEME) return themeId
  return getSystemMode()
}

const applyThemeToDocument = (themeId) => {
  if (!import.meta.client) return
  const normalizedThemeId = appearanceThemeIds.has(themeId) ? themeId : SYSTEM_APPEARANCE_THEME
  const resolvedThemeId = getResolvedThemeId(normalizedThemeId)
  const resolvedTheme = getAppearanceTheme(resolvedThemeId)
  const root = document.documentElement

  root.dataset.appearanceChoice = normalizedThemeId
  root.dataset.appearanceTheme = resolvedTheme.id
  root.dataset.appearanceMode = resolvedTheme.mode
  root.style.colorScheme = resolvedTheme.mode
}

export const useAppearance = () => {
  const setAppearanceTheme = (themeId) => {
    const normalizedThemeId = appearanceThemeIds.has(themeId) ? themeId : SYSTEM_APPEARANCE_THEME
    selectedTheme.value = normalizedThemeId
    if (import.meta.client) {
      localStorage.setItem(storageKey, normalizedThemeId)
    }
    applyThemeToDocument(normalizedThemeId)
  }

  const initAppearance = () => {
    if (!import.meta.client) return

    const storedTheme = localStorage.getItem(storageKey) || SYSTEM_APPEARANCE_THEME
    selectedTheme.value = appearanceThemeIds.has(storedTheme) ? storedTheme : SYSTEM_APPEARANCE_THEME
    applyThemeToDocument(selectedTheme.value)

    if (!initialized && window.matchMedia) {
      mediaQuery = window.matchMedia('(prefers-color-scheme: light)')
      mediaQuery.addEventListener('change', () => {
        if (selectedTheme.value === SYSTEM_APPEARANCE_THEME) {
          applyThemeToDocument(SYSTEM_APPEARANCE_THEME)
        }
      })
      initialized = true
    }
  }

  return {
    selectedTheme,
    resolvedTheme: computed(() => getAppearanceTheme(getResolvedThemeId(selectedTheme.value))),
    setAppearanceTheme,
    initAppearance,
  }
}
