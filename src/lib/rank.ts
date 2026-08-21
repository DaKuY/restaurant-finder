import { cuisineById } from '../data/cuisines'
import { keywordBoost } from './keyword'
import { seedOilGradeScore, type SeedOilInfo } from './seedOil'
import type {
  CuisineId,
  DietaryId,
  LatLng,
  RankedRestaurant,
  Restaurant,
  TasteProfile,
} from './types'

const GRASS_FED_KEYWORDS = [
  'grass fed',
  'grass-fed',
  'grassfed',
  'pasture',
  'pastured',
  'pasture-raised',
  'regenerative',
  '100% grass',
  'wagyu',
  'dry aged',
  'dry-aged',
]

function haversineKm(a: LatLng, b: LatLng): number {
  const R = 6371
  const dLat = ((b.lat - a.lat) * Math.PI) / 180
  const dLon = ((b.lon - a.lon) * Math.PI) / 180
  const lat1 = (a.lat * Math.PI) / 180
  const lat2 = (b.lat * Math.PI) / 180
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

function matchesCuisine(place: Restaurant, cuisineId: CuisineId): boolean {
  const opt = cuisineById(cuisineId)
  const blob = `${place.cuisineRaw ?? ''} ${place.cuisines.join(' ')} ${place.name} ${place.amenity ?? ''}`.toLowerCase()
  return (
    opt.osmTags.some((t) => place.cuisines.includes(t) || blob.includes(t.replace(/_/g, ' '))) ||
    opt.keywords.some((k) => blob.includes(k.toLowerCase()))
  )
}

function dietaryBoost(place: Restaurant, dietary: DietaryId[]): { points: number; reasons: string[] } {
  let points = 0
  const reasons: string[] = []
  for (const d of dietary) {
    if (d === 'vegetarian' && isYes(place.vegetarian)) {
      points += 8
      reasons.push('Marked vegetarian-friendly on the map')
    }
    if (d === 'vegan' && (isYes(place.vegan) || place.cuisines.includes('vegan'))) {
      points += 10
      reasons.push('Vegan-friendly signal in OpenStreetMap')
    }
    if (d === 'gluten_free' && isYes(place.glutenFree)) {
      points += 8
      reasons.push('Gluten-free options noted')
    }
    if (d === 'halal' && isYes(place.halal)) {
      points += 10
      reasons.push('Halal-tagged on the map')
    }
    if (d === 'grass_fed') {
      const blob = `${place.name} ${place.cuisineRaw ?? ''} ${place.cuisines.join(' ')}`.toLowerCase()
      if (GRASS_FED_KEYWORDS.some((k) => blob.includes(k))) {
        points += 12
        reasons.push('Grass-fed or pasture-raised signals in the listing')
      }
    }
  }
  return { points, reasons }
}

function isYes(v?: string): boolean {
  if (!v) return false
  const s = v.toLowerCase()
  return s === 'yes' || s === 'only' || s === 'limited'
}

export function isFastFood(place: Restaurant): boolean {
  if (place.amenity === 'fast_food') return true
  if (place.cuisines.includes('fast_food')) return true
  const raw = (place.cuisineRaw ?? '').toLowerCase()
  return raw.split(/[;,]/).some((c) => c.trim() === 'fast_food')
}

function tasteBoost(place: Restaurant, taste: TasteProfile): { points: number; reasons: string[] } {
  let points = 0
  const reasons: string[] = []

  for (const c of place.cuisines) {
    const w = taste.cuisineWeights[c] ?? 0
    if (w > 0) {
      points += Math.min(12, w * 3)
    }
  }

  const lovedHit = taste.loved.find(
    (l) =>
      l.name.toLowerCase() === place.name.toLowerCase() ||
      l.cuisines.some((c) => place.cuisines.includes(c)),
  )
  if (lovedHit && lovedHit.name.toLowerCase() === place.name.toLowerCase()) {
    points += 25
    reasons.push('You already marked this place as a favorite')
  } else if (lovedHit) {
    points += 10
    reasons.push(`Similar to places you love (like ${lovedHit.name})`)
  }

  const skipped = taste.skipped.some((s) => s.name.toLowerCase() === place.name.toLowerCase())
  if (skipped) {
    points -= 40
    reasons.push('You previously skipped this place')
  }

  // Aggregate cuisine weight reason once
  const strong = place.cuisines.filter((c) => (taste.cuisineWeights[c] ?? 0) >= 2)
  if (strong.length) {
    reasons.push(`Matches cuisines you tend to enjoy (${strong.slice(0, 2).join(', ')})`)
  }

  return { points, reasons }
}

function completeness(place: Restaurant): { points: number; reasons: string[] } {
  let points = 0
  const reasons: string[] = []
  if (place.website) {
    points += 8
    reasons.push('Has a website listed')
  }
  if (place.phone) points += 3
  if (place.address) points += 3
  if (place.openingHours) {
    points += 4
    reasons.push('Opening hours are mapped')
  }
  if (place.cuisines.length) points += 4
  if (place.amenity === 'restaurant') points += 2
  return { points, reasons }
}

export function rankRestaurants(
  places: Restaurant[],
  opts: {
    center: LatLng
    selectedCuisines: CuisineId[]
    dietary: DietaryId[]
    keyword?: string
    taste: TasteProfile
    limit?: number
    excludeIds?: Iterable<string>
    excludeFastFood?: boolean
    seedOilByPlaceId?: Record<string, SeedOilInfo>
  },
): RankedRestaurant[] {
  const limit = opts.limit ?? 10
  const exclude = opts.excludeIds ? new Set(opts.excludeIds) : null
  let pool = exclude ? places.filter((p) => !exclude.has(p.id)) : places
  if (opts.excludeFastFood) pool = pool.filter((p) => !isFastFood(p))

  const keywordOnly = opts.selectedCuisines.length === 0 && Boolean(opts.keyword?.trim())
  if (keywordOnly) {
    pool = pool.filter((p) => keywordBoost(p, opts.keyword!).points > 0)
  }

  const ranked: RankedRestaurant[] = pool.map((place) => {
    const reasons: string[] = []
    let score = 0

    if (keywordOnly) {
      const kw = keywordBoost(place, opts.keyword!)
      score += kw.points
      reasons.push(...kw.reasons)
    } else {
      const matched = opts.selectedCuisines.filter((c) => matchesCuisine(place, c))
      if (matched.length) {
        score += 30 + matched.length * 8
        reasons.push(
          `Fits your pick${matched.length > 1 ? 's' : ''}: ${matched
            .map((id) => cuisineById(id).label)
            .join(', ')}`,
        )
      } else {
        score -= 5
      }

      if (opts.keyword?.trim()) {
        const kw = keywordBoost(place, opts.keyword)
        score += kw.points
        reasons.push(...kw.reasons)
      }
    }

    const diet = dietaryBoost(place, opts.dietary)
    score += diet.points
    reasons.push(...diet.reasons)

    if (opts.dietary.includes('no_seed_oils') && opts.seedOilByPlaceId) {
      const info = opts.seedOilByPlaceId[place.id]
      if (info?.grade) {
        const boost = seedOilGradeScore(info.grade)
        score += boost
        if (boost > 0) {
          reasons.push(`Seed Oil Tracker grade ${info.grade} — lower seed-oil risk`)
        } else if (boost < 0) {
          reasons.push(`Seed Oil Tracker grade ${info.grade} — higher seed-oil use`)
        }
      }
    }

    const taste = tasteBoost(place, opts.taste)
    score += taste.points
    reasons.push(...taste.reasons)

    const complete = completeness(place)
    score += complete.points
    reasons.push(...complete.reasons)

    const distanceKm = haversineKm(opts.center, { lat: place.lat, lon: place.lon })
    score += Math.max(0, 12 - distanceKm * 1.5)
    if (distanceKm < 1.5) reasons.push('Close to your selected area')

    // Unique-ish reasons, max 4
    const uniq = Array.from(new Set(reasons)).slice(0, 4)
    if (!uniq.length) uniq.push('Mapped local spot that matched your search area')

    return { ...place, score, reasons: uniq, distanceKm }
  })

  return ranked
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}

export function isProbablyOpenNow(openingHours?: string, now = new Date()): boolean | null {
  if (!openingHours) return null
  // Very light heuristic: "24/7"
  if (/24\/7/i.test(openingHours)) return true
  // Mo-Su 11:00-22:00 style — parse simple single range
  const m = openingHours.match(
    /(?:Mo|Tu|We|Th|Fr|Sa|Su)[-,]?(?:Mo|Tu|We|Th|Fr|Sa|Su)?\s+(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})/i,
  )
  if (!m) return null
  const open = Number(m[1]) * 60 + Number(m[2])
  const close = Number(m[3]) * 60 + Number(m[4])
  const mins = now.getHours() * 60 + now.getMinutes()
  if (close < open) return mins >= open || mins <= close
  return mins >= open && mins <= close
}
