export const SYSTEM_APPEARANCE_THEME = 'system'

export const appearanceThemes = [
  {
    id: SYSTEM_APPEARANCE_THEME,
    name: 'System Default',
    description: "Follows your operating system's light/dark preference",
    mode: 'system',
    swatches: ['#f8fafc', '#e2e8f0', '#64748b', '#0f172a'],
  },
  {
    id: 'light',
    name: 'Light',
    mode: 'light',
    swatches: ['#4f46e5', '#ec4899', '#14b8a6', '#f8fafc'],
  },
  {
    id: 'retro',
    name: 'Retro',
    mode: 'light',
    swatches: ['#ef9995', '#a4cbb4', '#dc8a00', '#665c54'],
  },
  {
    id: 'cupcake',
    name: 'Cupcake',
    mode: 'light',
    swatches: ['#65c3c8', '#ef9fbc', '#e3d5a4', '#291334'],
  },
  {
    id: 'bumblebee',
    name: 'Bumblebee',
    mode: 'light',
    swatches: ['#fbbf24', '#f59e0b', '#18181b', '#e5e7eb'],
  },
  {
    id: 'emerald',
    name: 'Emerald',
    mode: 'light',
    swatches: ['#66cc8a', '#3b82f6', '#fb7c63', '#334155'],
  },
  {
    id: 'corporate',
    name: 'Corporate',
    mode: 'light',
    swatches: ['#0ea5e9', '#64748b', '#0d9488', '#111827'],
  },
  {
    id: 'garden',
    name: 'Garden',
    mode: 'light',
    swatches: ['#ec4899', '#8b3a62', '#4f6f52', '#2f2504'],
  },
  {
    id: 'lofi',
    name: 'Lofi',
    mode: 'light',
    swatches: ['#ffffff', '#18181b', '#27272a', '#000000'],
  },
  {
    id: 'pastel',
    name: 'Pastel',
    mode: 'light',
    swatches: ['#d8b4fe', '#fecdd3', '#a7f3d0', '#94a3b8'],
  },
  {
    id: 'fantasy',
    name: 'Fantasy',
    mode: 'light',
    swatches: ['#7e22ce', '#0284c7', '#f97316', '#1f2937'],
  },
  {
    id: 'wireframe',
    name: 'Wireframe',
    mode: 'light',
    swatches: ['#f9fafb', '#d4d4d4', '#737373', '#262626'],
  },
  {
    id: 'cmyk',
    name: 'CMYK',
    mode: 'light',
    swatches: ['#38bdf8', '#ec4899', '#facc15', '#18181b'],
  },
  {
    id: 'autumn',
    name: 'Autumn',
    mode: 'light',
    swatches: ['#8c0327', '#d1495b', '#dda15e', '#8d6b53'],
  },
  {
    id: 'lemonade',
    name: 'Lemonade',
    mode: 'light',
    swatches: ['#3f8f00', '#b8c500', '#f2d500', '#3f3c00'],
  },
  {
    id: 'winter',
    name: 'Winter',
    mode: 'light',
    swatches: ['#0f6bff', '#3730a3', '#a855f7', '#082f49'],
  },
  {
    id: 'nord',
    name: 'Nord',
    mode: 'light',
    swatches: ['#5e81ac', '#81a1c1', '#88c0d0', '#4c566a'],
  },
  {
    id: 'caramellatte',
    name: 'Caramellatte',
    mode: 'light',
    swatches: ['#000000', '#7c2d12', '#ea580c', '#fff7ed'],
  },
  {
    id: 'dark',
    name: 'Dark',
    mode: 'dark',
    swatches: ['#4f46e5', '#ec4899', '#14b8a6', '#111827'],
  },
  {
    id: 'forest',
    name: 'Forest',
    mode: 'dark',
    swatches: ['#4338ca', '#ec4899', '#14b8a6', '#020617'],
  },
  {
    id: 'dim',
    name: 'Dim',
    mode: 'dark',
    swatches: ['#9ae6b4', '#fb7185', '#c084fc', '#334155'],
  },
  {
    id: 'dracula',
    name: 'Dracula',
    mode: 'dark',
    swatches: ['#ff79c6', '#bd93f9', '#ffb86c', '#44475a'],
  },
  {
    id: 'synthwave',
    name: 'Synthwave',
    mode: 'dark',
    swatches: ['#f472b6', '#67e8f9', '#fb8500', '#3b1ab3'],
  },
  {
    id: 'halloween',
    name: 'Halloween',
    mode: 'dark',
    swatches: ['#fb8500', '#7e22ce', '#4ade80', '#431407'],
  },
  {
    id: 'luxury',
    name: 'Luxury',
    mode: 'dark',
    swatches: ['#ffffff', '#0f172a', '#4c2d3d', '#431407'],
  },
  {
    id: 'night',
    name: 'Night',
    mode: 'dark',
    swatches: ['#38bdf8', '#818cf8', '#f472b6', '#172033'],
  },
  {
    id: 'coffee',
    name: 'Coffee',
    mode: 'dark',
    swatches: ['#fb923c', '#1f4046', '#0e7490', '#2a1725'],
  },
  {
    id: 'business',
    name: 'Business',
    mode: 'dark',
    swatches: ['#22577a', '#8da0a6', '#f26444', '#202020'],
  },
  {
    id: 'sunset',
    name: 'Sunset',
    mode: 'dark',
    swatches: ['#fb7185', '#a78bfa', '#1f2937', '#0f172a'],
  },
  {
    id: 'abyss',
    name: 'Abyss',
    mode: 'dark',
    swatches: ['#a3ff12', '#c4b5fd', '#525252', '#073b4c'],
  },
]

export const appearanceThemeIds = new Set(appearanceThemes.map((theme) => theme.id))

export const getAppearanceTheme = (themeId) => (
  appearanceThemes.find((theme) => theme.id === themeId) || appearanceThemes[0]
)

export const lightAppearanceThemes = appearanceThemes.filter((theme) => theme.mode === 'light')
export const darkAppearanceThemes = appearanceThemes.filter((theme) => theme.mode === 'dark')
