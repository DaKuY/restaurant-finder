import type { CitySelection } from './types'

let lastGeocodeAt = 0

async function throttleGeocode(): Promise<void> {
  const wait = Math.max(0, 1100 - (Date.now() - lastGeocodeAt))
  if (wait > 0) await new Promise((r) => setTimeout(r, wait))
  lastGeocodeAt = Date.now()
}

export type GeocodeHit = {
  label: string
  lat: number
  lon: number
  south: number
  west: number
  north: number
  east: number
}

function bboxFromPoint(lat: number, lon: number, delta = 0.08) {
  return {
    south: lat - delta,
    west: lon - delta,
    north: lat + delta,
    east: lon + delta,
  }
}

async function searchPhoton(query: string, signal?: AbortSignal): Promise<GeocodeHit[]> {
  const url = new URL('https://photon.komoot.io/api/')
  url.searchParams.set('q', query)
  url.searchParams.set('limit', '6')
  url.searchParams.set('lang', 'en')
  // Prefer places over streets
  url.searchParams.set('osm_tag', 'place:city')
  url.searchParams.append('osm_tag', 'place:town')
  url.searchParams.append('osm_tag', 'place:village')
  url.searchParams.append('osm_tag', 'place:suburb')
  url.searchParams.append('osm_tag', 'place:neighbourhood')
  url.searchParams.append('osm_tag', 'place:hamlet')
  url.searchParams.append('osm_tag', 'boundary:administrative')

  const res = await fetch(url.toString(), { signal })
  if (!res.ok) throw new Error(`Photon ${res.status}`)
  const data = (await res.json()) as {
    features?: Array<{
      geometry: { coordinates: [number, number] }
      properties: {
        name?: string
        city?: string
        state?: string
        country?: string
        extent?: [number, number, number, number]
      }
    }>
  }

  return (data.features ?? []).map((f) => {
    const [lon, lat] = f.geometry.coordinates
    const p = f.properties
    const label = [p.name, p.city, p.state, p.country].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(', ')
    const extent = p.extent
    // Photon extent is [minLon, maxLat, maxLon, minLat] per docs — verify: actually [west, south, east, north] in some versions
    // Official: extent: [minLon, maxLat, maxLon, minLat]
    let bounds
    if (extent && extent.length === 4) {
      const [minLon, maxLat, maxLon, minLat] = extent
      bounds = { south: minLat, west: minLon, north: maxLat, east: maxLon }
    } else {
      bounds = bboxFromPoint(lat, lon)
    }
    return { label: label || p.name || query, lat, lon, ...bounds }
  })
}

async function searchNominatim(query: string, signal?: AbortSignal): Promise<GeocodeHit[]> {
  const url = new URL('https://nominatim.openstreetmap.org/search')
  url.searchParams.set('q', query)
  url.searchParams.set('format', 'jsonv2')
  url.searchParams.set('limit', '6')
  url.searchParams.set('addressdetails', '0')

  const res = await fetch(url.toString(), {
    signal,
    headers: {
      Accept: 'application/json',
    },
  })
  if (!res.ok) throw new Error(`Nominatim ${res.status}`)
  const data = (await res.json()) as Array<{
    display_name: string
    lat: string
    lon: string
    boundingbox?: [string, string, string, string]
  }>

  return data.map((d) => {
    const lat = Number(d.lat)
    const lon = Number(d.lon)
    let bounds
    if (d.boundingbox?.length === 4) {
      const [south, north, west, east] = d.boundingbox.map(Number)
      bounds = { south, west, north, east }
    } else {
      bounds = bboxFromPoint(lat, lon)
    }
    return { label: d.display_name, lat, lon, ...bounds }
  })
}

export async function searchCities(query: string, signal?: AbortSignal): Promise<GeocodeHit[]> {
  const q = query.trim()
  if (q.length < 2) return []
  await throttleGeocode()
  try {
    const hits = await searchPhoton(q, signal)
    if (hits.length) return hits
  } catch {
    // fall through
  }
  await throttleGeocode()
  return searchNominatim(q, signal)
}

export async function reverseGeocode(lat: number, lon: number, signal?: AbortSignal): Promise<string> {
  await throttleGeocode()
  try {
    const url = new URL('https://photon.komoot.io/reverse')
    url.searchParams.set('lat', String(lat))
    url.searchParams.set('lon', String(lon))
    const res = await fetch(url.toString(), { signal })
    if (res.ok) {
      const data = (await res.json()) as {
        features?: Array<{ properties: { name?: string; city?: string; state?: string; country?: string } }>
      }
      const p = data.features?.[0]?.properties
      if (p) {
        return [p.name, p.city, p.state, p.country].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(', ')
      }
    }
  } catch {
    // fall through
  }
  return `${lat.toFixed(3)}, ${lon.toFixed(3)}`
}

export async function coordsToCitySelection(
  lat: number,
  lon: number,
  delta = 0.04,
): Promise<CitySelection> {
  let label = `${lat.toFixed(3)}, ${lon.toFixed(3)}`
  try {
    label = await reverseGeocode(lat, lon)
  } catch {
    // keep coords
  }
  return {
    label,
    center: { lat, lon },
    bounds: { south: lat - delta, west: lon - delta, north: lat + delta, east: lon + delta },
    source: 'map',
  }
}
