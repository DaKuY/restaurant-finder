import { readCache, readStaleCache, writeCache } from './storage'
import type { MapBounds, Restaurant } from './types'

/** Public Overpass mirrors — order is a hint; we race and fall back across all of them. */
const MIRRORS = [
  'https://overpass.openstreetmap.fr/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://overpass.osm.jp/api/interpreter',
]

const CACHE_TTL_MS = 1000 * 60 * 60 * 12 // 12 hours
const STALE_CACHE_MAX_MS = 1000 * 60 * 60 * 24 * 7 // 7 days — offline fallback
const MIRROR_TIMEOUT_MS = 15000
const QUERY_TIMEOUT_SEC = 25
const RETRY_DELAY_MS = 2000
const MAX_ATTEMPTS = 2
const RESULT_CAP = 300

type OverpassElement = {
  type: string
  id: number
  lat?: number
  lon?: number
  center?: { lat: number; lon: number }
  tags?: Record<string, string>
}

function buildAreaQuery(bounds: MapBounds): string {
  const { south, west, north, east } = bounds
  const bbox = `${south},${west},${north},${east}`
  return `
[out:json][timeout:${QUERY_TIMEOUT_SEC}];
nwr["amenity"~"^(restaurant|cafe|fast_food|ice_cream|food_court)$"](${bbox});
out center tags ${RESULT_CAP};
`.trim()
}

function elementToRestaurant(el: OverpassElement): Restaurant | null {
  const tags = el.tags ?? {}
  const name = tags.name || tags['name:en']
  if (!name) return null
  const lat = el.lat ?? el.center?.lat
  const lon = el.lon ?? el.center?.lon
  if (lat == null || lon == null) return null

  const cuisineRaw = tags.cuisine ?? ''
  const cuisines = cuisineRaw
    .split(/[;,]/)
    .map((c) => c.trim().toLowerCase())
    .filter(Boolean)

  const address = [tags['addr:housenumber'], tags['addr:street'], tags['addr:city']]
    .filter(Boolean)
    .join(' ')

  return {
    id: `${el.type}/${el.id}`,
    name,
    lat,
    lon,
    cuisines,
    cuisineRaw,
    address: address || tags['addr:full'] || undefined,
    phone: tags.phone || tags['contact:phone'],
    website: tags.website || tags['contact:website'] || tags['contact:facebook'],
    openingHours: tags.opening_hours,
    vegetarian: tags.vegetarian || tags.diet_vegetarian,
    vegan: tags.vegan || tags.diet_vegan,
    glutenFree: tags.gluten_free || tags['diet:gluten_free'],
    halal: tags.halal || tags.diet_halal,
    amenity: tags.amenity,
  }
}

function dedupe(places: Restaurant[]): Restaurant[] {
  const seen = new Map<string, Restaurant>()
  for (const p of places) {
    const key = `${p.name.toLowerCase().replace(/\s+/g, ' ')}|${p.lat.toFixed(3)}|${p.lon.toFixed(3)}`
    const existing = seen.get(key)
    if (!existing) {
      seen.set(key, p)
      continue
    }
    const score = (r: Restaurant) =>
      [r.website, r.phone, r.address, r.openingHours, r.cuisineRaw].filter(Boolean).length
    if (score(p) > score(existing)) seen.set(key, p)
  }
  return Array.from(seen.values())
}

function cacheKey(bounds: MapBounds): string {
  const b = [bounds.south, bounds.west, bounds.north, bounds.east]
    .map((n) => n.toFixed(3))
    .join(',')
  return `overpass:v4:area:${b}`
}

function isAbortError(e: unknown): boolean {
  if (e instanceof AggregateError) {
    return e.errors.length > 0 && e.errors.every(isAbortError)
  }
  return e instanceof DOMException
    ? e.name === 'AbortError'
    : (e as Error)?.name === 'AbortError'
}

async function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(new DOMException('Aborted', 'AbortError'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

async function fetchMirror(mirror: string, query: string, signal?: AbortSignal): Promise<Restaurant[]> {
  const controller = new AbortController()
  const onAbort = () => controller.abort()
  signal?.addEventListener('abort', onAbort)
  const timer = setTimeout(() => controller.abort(), MIRROR_TIMEOUT_MS)
  try {
    const res = await fetch(mirror, {
      method: 'POST',
      body: `data=${encodeURIComponent(query)}`,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      signal: controller.signal,
    })
    if (!res.ok) throw new Error(`Overpass ${res.status} @ ${mirror}`)
    const data = (await res.json()) as { elements?: OverpassElement[] }
    const places = (data.elements ?? [])
      .map(elementToRestaurant)
      .filter((p): p is Restaurant => p != null)
    return dedupe(places)
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}

async function fetchFromMirrorsParallel(query: string, signal?: AbortSignal): Promise<Restaurant[]> {
  return Promise.any(MIRRORS.map((mirror) => fetchMirror(mirror, query, signal)))
}

async function fetchFromMirrorsSequential(query: string, signal?: AbortSignal): Promise<Restaurant[]> {
  let lastError: unknown
  for (const mirror of MIRRORS) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    try {
      return await fetchMirror(mirror, query, signal)
    } catch (e) {
      lastError = e
      if (isAbortError(e)) throw e
    }
  }
  throw lastError ?? new Error('All Overpass mirrors failed')
}

async function fetchLive(bounds: MapBounds, signal?: AbortSignal): Promise<Restaurant[]> {
  const query = buildAreaQuery(bounds)
  let lastError: unknown

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    try {
      if (attempt === 0) return await fetchFromMirrorsParallel(query, signal)
      return await fetchFromMirrorsSequential(query, signal)
    } catch (e) {
      lastError = e
      if (isAbortError(e)) throw e
      if (attempt < MAX_ATTEMPTS - 1) await delay(RETRY_DELAY_MS, signal)
    }
  }

  throw lastError ?? new Error('All Overpass mirrors failed')
}

/** All mapped restaurants/cafes in the visible area. Cuisine ranking happens client-side. */
export async function fetchRestaurants(bounds: MapBounds, signal?: AbortSignal): Promise<Restaurant[]> {
  const key = cacheKey(bounds)
  const cached = readCache<Restaurant[]>(key)
  if (cached) return cached

  try {
    const places = await fetchLive(bounds, signal)
    writeCache(key, places, CACHE_TTL_MS)
    return places
  } catch (e) {
    if (isAbortError(e)) throw e
    const stale = readStaleCache<Restaurant[]>(key, STALE_CACHE_MAX_MS)
    if (stale) return stale
    throw e
  }
}
