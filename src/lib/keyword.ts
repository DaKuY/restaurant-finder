import type { Restaurant } from './types'

export const KEYWORD_SUGGESTIONS = [
  'wild caught fish',
  'grass fed steak',
  'organic fruit',
  'pasture raised',
  'wild salmon',
  'raw honey',
  'sourdough bread',
] as const

export function normalizeKeyword(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[-_/]+/g, ' ')
    .replace(/\s+/g, ' ')
}

export function placeSearchBlob(place: Restaurant): string {
  return `${place.name} ${place.cuisineRaw ?? ''} ${place.cuisines.join(' ')} ${place.amenity ?? ''}`.toLowerCase()
}

export function keywordBoost(
  place: Restaurant,
  keyword: string,
): { points: number; reasons: string[] } {
  const normalized = normalizeKeyword(keyword)
  if (!normalized) return { points: 0, reasons: [] }

  const blob = placeSearchBlob(place)
  const name = place.name.toLowerCase()
  const reasons: string[] = []
  let points = 0

  if (blob.includes(normalized)) {
    points += name.includes(normalized) ? 22 : 16
    reasons.push(`Matches your keyword “${keyword.trim()}”`)
    return { points, reasons }
  }

  const tokens = normalized.split(' ').filter((t) => t.length >= 3)
  if (tokens.length >= 2) {
    const matched = tokens.filter((t) => blob.includes(t))
    if (matched.length === tokens.length) {
      points += 12
      reasons.push(`Listing mentions terms from “${keyword.trim()}”`)
    } else if (matched.length >= Math.ceil(tokens.length / 2)) {
      points += 6
      reasons.push(`Partial match for “${keyword.trim()}”`)
    }
  } else if (tokens.length === 1 && blob.includes(tokens[0]!)) {
    points += 10
    reasons.push(`Matches your keyword “${keyword.trim()}”`)
  }

  return { points, reasons }
}
