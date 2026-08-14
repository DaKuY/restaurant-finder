export type LatLng = {
  lat: number
  lon: number
}

export type MapBounds = {
  south: number
  west: number
  north: number
  east: number
}

export type CitySelection = {
  label: string
  center: LatLng
  bounds: MapBounds
  source: 'search' | 'map'
}

export type CuisineId =
  | 'salmon'
  | 'steak'
  | 'salad'
  | 'smoothie'
  | 'burger'
  | 'tacos'
  | 'ramen'
  | 'bowl'
  | 'coffee'
  | 'seafood'
  | 'indian'
  | 'chinese'
  | 'japanese'
  | 'italian'
  | 'healthy'
  | 'mexican'
  | 'thai'
  | 'korean'
  | 'mediterranean'
  | 'american'
  | 'pizza'
  | 'sushi'
  | 'vegan'
  | 'bbq'

export type DietaryId =
  | 'vegetarian'
  | 'vegan'
  | 'gluten_free'
  | 'halal'
  | 'grass_fed'
  | 'no_seed_oils'

export type Restaurant = {
  id: string
  name: string
  lat: number
  lon: number
  cuisines: string[]
  address?: string
  phone?: string
  website?: string
  openingHours?: string
  vegetarian?: string
  vegan?: string
  glutenFree?: string
  halal?: string
  amenity?: string
  cuisineRaw?: string
}

export type RankedRestaurant = Restaurant & {
  score: number
  reasons: string[]
  distanceKm: number
}

export type TastePlace = {
  id: string
  name: string
  city?: string
  cuisines: string[]
  rating: number
  vibeTags: string[]
  note?: string
  savedAt: string
}

export type TasteProfile = {
  version: 1
  loved: TastePlace[]
  skipped: TastePlace[]
  cuisineWeights: Record<string, number>
  dietaryPrefs: DietaryId[]
  vibeWeights: Record<string, number>
}

export type SearchParams = {
  cityLabel: string
  lat: number
  lon: number
  south: number
  west: number
  north: number
  east: number
  cuisines: CuisineId[]
  dietary: DietaryId[]
  keyword?: string
}
