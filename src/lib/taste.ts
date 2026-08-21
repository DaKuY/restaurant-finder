import { readJson, writeJson } from './storage'
import type { CitySelection, DietaryId, TastePlace, TasteProfile } from './types'

const KEY = 'taste'
const MAX_LOVED = 80
const MAX_SKIPPED = 80

export function emptyTaste(): TasteProfile {
  return {
    version: 1,
    loved: [],
    skipped: [],
    cuisineWeights: {},
    dietaryPrefs: [],
    vibeWeights: {},
  }
}

export function loadTaste(): TasteProfile {
  const t = readJson<TasteProfile>(KEY, emptyTaste())
  if (t.version !== 1) return emptyTaste()
  return {
    ...emptyTaste(),
    ...t,
    loved: t.loved ?? [],
    skipped: t.skipped ?? [],
    cuisineWeights: t.cuisineWeights ?? {},
    dietaryPrefs: t.dietaryPrefs ?? [],
    vibeWeights: t.vibeWeights ?? {},
  }
}

export function saveTaste(taste: TasteProfile): void {
  writeJson(KEY, {
    ...taste,
    loved: taste.loved.slice(0, MAX_LOVED),
    skipped: taste.skipped.slice(0, MAX_SKIPPED),
  })
}

function bumpCuisine(weights: Record<string, number>, cuisines: string[], delta: number) {
  for (const c of cuisines) {
    const key = c.toLowerCase()
    weights[key] = (weights[key] ?? 0) + delta
  }
}

export function lovePlace(taste: TasteProfile, place: Omit<TastePlace, 'savedAt'> & { savedAt?: string }): TasteProfile {
  const next = structuredClone(taste)
  next.skipped = next.skipped.filter((s) => s.name.toLowerCase() !== place.name.toLowerCase())
  next.loved = [
    {
      ...place,
      rating: place.rating ?? 5,
      vibeTags: place.vibeTags ?? [],
      cuisines: place.cuisines ?? [],
      savedAt: place.savedAt ?? new Date().toISOString(),
    },
    ...next.loved.filter((l) => l.name.toLowerCase() !== place.name.toLowerCase()),
  ].slice(0, MAX_LOVED)
  bumpCuisine(next.cuisineWeights, place.cuisines, 2)
  for (const v of place.vibeTags ?? []) {
    next.vibeWeights[v] = (next.vibeWeights[v] ?? 0) + 1
  }
  saveTaste(next)
  return next
}

export function skipPlace(taste: TasteProfile, place: Omit<TastePlace, 'savedAt'> & { savedAt?: string }): TasteProfile {
  const next = structuredClone(taste)
  next.loved = next.loved.filter((l) => l.name.toLowerCase() !== place.name.toLowerCase())
  next.skipped = [
    {
      ...place,
      rating: place.rating ?? 1,
      vibeTags: place.vibeTags ?? [],
      cuisines: place.cuisines ?? [],
      savedAt: place.savedAt ?? new Date().toISOString(),
    },
    ...next.skipped.filter((s) => s.name.toLowerCase() !== place.name.toLowerCase()),
  ].slice(0, MAX_SKIPPED)
  bumpCuisine(next.cuisineWeights, place.cuisines, -1)
  saveTaste(next)
  return next
}

export function setDietaryPrefs(taste: TasteProfile, dietary: DietaryId[]): TasteProfile {
  const next = { ...taste, dietaryPrefs: dietary }
  saveTaste(next)
  return next
}

export function removeLoved(taste: TasteProfile, id: string): TasteProfile {
  const next = { ...taste, loved: taste.loved.filter((l) => l.id !== id) }
  saveTaste(next)
  return next
}

export function exportTaste(taste: TasteProfile): string {
  return JSON.stringify(taste, null, 2)
}

export function importTaste(json: string): TasteProfile {
  const parsed = JSON.parse(json) as TasteProfile
  if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.loved)) {
    throw new Error('Invalid taste profile JSON')
  }
  const next: TasteProfile = {
    ...emptyTaste(),
    ...parsed,
    loved: (parsed.loved ?? []).slice(0, MAX_LOVED),
    skipped: (parsed.skipped ?? []).slice(0, MAX_SKIPPED),
  }
  saveTaste(next)
  return next
}

export type ShortlistItem = {
  id: string
  name: string
  lat: number
  lon: number
  city?: string
}

const SHORTLIST_KEY = 'shortlist'

export function loadShortlist(): ShortlistItem[] {
  return readJson<ShortlistItem[]>(SHORTLIST_KEY, []).slice(0, 40)
}

export function saveShortlist(items: ShortlistItem[]): void {
  writeJson(SHORTLIST_KEY, items.slice(0, 40))
}

export function toggleShortlist(items: ShortlistItem[], item: ShortlistItem): ShortlistItem[] {
  const exists = items.some((i) => i.id === item.id)
  const next = exists ? items.filter((i) => i.id !== item.id) : [item, ...items]
  saveShortlist(next)
  return next
}

export type RecentCity = {
  label: string
  lat: number
  lon: number
  south: number
  west: number
  north: number
  east: number
}

const RECENT_KEY = 'recentCities'

export function loadRecentCities(): RecentCity[] {
  return readJson<RecentCity[]>(RECENT_KEY, []).slice(0, 8)
}

export function recentToCitySelection(recent: RecentCity): CitySelection {
  return {
    label: recent.label,
    center: { lat: recent.lat, lon: recent.lon },
    bounds: { south: recent.south, west: recent.west, north: recent.north, east: recent.east },
    source: 'search',
  }
}

export function pushRecentCity(city: RecentCity): RecentCity[] {
  const next = [city, ...loadRecentCities().filter((c) => c.label !== city.label)].slice(0, 8)
  writeJson(RECENT_KEY, next)
  return next
}
