export const MEDIASTORM_SERVICES = new Set(['mediastorm'])

const MEDIASTORM_NAVIGATION_ENTRY_PATHS = new Set([
  '/admin',
  '/account',
  '/watch',
  '/register',
])

const MEDIASTORM_NAVIGATION_PATH_PREFIXES = [
  '/admin/',
  '/account/',
  '/watch/',
  '/share/',
  '/register/',
]

export const isMediaStormNavigationPath = (pathname) => {
  if (!pathname) return false
  return MEDIASTORM_NAVIGATION_ENTRY_PATHS.has(pathname) ||
    MEDIASTORM_NAVIGATION_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix))
}
