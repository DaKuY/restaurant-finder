import { useEffect, useMemo, useRef, useState } from 'react'
import { MapContainer, TileLayer, useMapEvents, Rectangle } from 'react-leaflet'
import L from 'leaflet'
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png'
import markerIcon from 'leaflet/dist/images/marker-icon.png'
import markerShadow from 'leaflet/dist/images/marker-shadow.png'
import { coordsToCitySelection, reverseGeocode, searchCities, type GeocodeHit } from '../lib/geocode'
import { loadRecentCities, pushRecentCity, recentToCitySelection, type RecentCity } from '../lib/taste'
import type { CitySelection, MapBounds } from '../lib/types'
import 'leaflet/dist/leaflet.css'

// Fix default marker icons under Vite
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
})

type Props = {
  onConfirm: (city: CitySelection) => void
  initial?: CitySelection | null
}

function BoundsWatcher({ onBounds }: { onBounds: (b: MapBounds, center: { lat: number; lon: number }) => void }) {
  const map = useMapEvents({
    moveend: () => {
      const b = map.getBounds()
      const c = map.getCenter()
      onBounds(
        { south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() },
        { lat: c.lat, lon: c.lng },
      )
    },
    zoomend: () => {
      const b = map.getBounds()
      const c = map.getCenter()
      onBounds(
        { south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() },
        { lat: c.lat, lon: c.lng },
      )
    },
  })
  return null
}

export function CityStep({ onConfirm, initial }: Props) {
  const [query, setQuery] = useState(initial?.label ?? '')
  const [hits, setHits] = useState<GeocodeHit[]>([])
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [locating, setLocating] = useState(false)
  const [recent, setRecent] = useState<RecentCity[]>(() => loadRecentCities())
  const [draft, setDraft] = useState<CitySelection | null>(initial ?? null)
  const [mapCenter, setMapCenter] = useState<[number, number]>([
    initial?.center.lat ?? 40.7128,
    initial?.center.lon ?? -74.006,
  ])
  const [mapKey, setMapKey] = useState(0)
  const skipSearchRef = useRef(Boolean(initial?.label))

  function applyLocation(city: CitySelection) {
    skipSearchRef.current = true
    setDraft(city)
    setMapCenter([city.center.lat, city.center.lon])
    setMapKey((k) => k + 1)
    setQuery(city.label)
    setHits([])
  }

  useEffect(() => {
    if (skipSearchRef.current) {
      skipSearchRef.current = false
      setHits([])
      return
    }
    if (query.trim().length < 2) {
      setHits([])
      return
    }
    const ctrl = new AbortController()
    const t = setTimeout(async () => {
      setSearching(true)
      setError(null)
      try {
        const results = await searchCities(query, ctrl.signal)
        setHits(results)
      } catch (e) {
        if ((e as Error).name !== 'AbortError') setError('City search failed. Try the map instead.')
      } finally {
        setSearching(false)
      }
    }, 400)
    return () => {
      clearTimeout(t)
      ctrl.abort()
    }
  }, [query])

  function scrollToTop() {
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function confirmCitySelection(city: CitySelection) {
    setRecent(
      pushRecentCity({
        label: city.label,
        lat: city.center.lat,
        lon: city.center.lon,
        ...city.bounds,
      }),
    )
    scrollToTop()
    onConfirm(city)
  }

  function selectHit(hit: GeocodeHit) {
    applyLocation({
      label: hit.label,
      center: { lat: hit.lat, lon: hit.lon },
      bounds: { south: hit.south, west: hit.west, north: hit.north, east: hit.east },
      source: 'search',
    })
  }

  function selectRecent(c: RecentCity) {
    confirmCitySelection(recentToCitySelection(c))
  }

  function runGeolocation() {
    if (!navigator.geolocation) {
      setError('Geolocation is not supported in this browser.')
      return
    }
    setLocating(true)
    setError(null)
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        applyLocation(await coordsToCitySelection(pos.coords.latitude, pos.coords.longitude))
        setLocating(false)
      },
      () => {
        setError('Could not get your location. Check browser permissions.')
        setLocating(false)
      },
      { enableHighAccuracy: true, timeout: 12000 },
    )
  }

  async function confirmMapArea() {
    if (!draft) {
      const lat = mapCenter[0]
      const lon = mapCenter[1]
      const delta = 0.06
      let label = `${lat.toFixed(3)}, ${lon.toFixed(3)}`
      try {
        label = await reverseGeocode(lat, lon)
      } catch {
        // keep coords
      }
      confirmCitySelection({
        label,
        center: { lat, lon },
        bounds: { south: lat - delta, west: lon - delta, north: lat + delta, east: lon + delta },
        source: 'map',
      })
      return
    }
    confirmCitySelection(draft)
  }

  const rectBounds = useMemo(() => {
    if (!draft) return null
    return [
      [draft.bounds.south, draft.bounds.west] as [number, number],
      [draft.bounds.north, draft.bounds.east] as [number, number],
    ]
  }, [draft])

  return (
    <section className="step city-step">
      <header className="step-header">
        <p className="eyebrow">Hunt4Food · Step 1</p>
        <h2>Where are you eating?</h2>
        <p className="lede">
          Hunt what&apos;s good nearby — type a city, tap <strong>Use my location</strong>, pick a recent spot,
          or zoom the map to a neighborhood and confirm that area.
        </p>
      </header>

      <label className="field">
        <span>City or neighborhood</span>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="e.g. Austin, Tokyo, Brooklyn"
          autoComplete="off"
        />
      </label>

      <button
        type="button"
        className="btn ghost location-btn"
        onClick={runGeolocation}
        disabled={locating}
        aria-busy={locating}
      >
        {locating ? 'Locating…' : 'Use my location'}
      </button>

      {searching && <p className="muted">Searching…</p>}
      {error && <p className="error">{error}</p>}

      {hits.length > 0 && (
        <ul className="hit-list">
          {hits.map((h) => (
            <li key={`${h.label}-${h.lat}`}>
              <button type="button" onClick={() => selectHit(h)}>
                {h.label}
              </button>
            </li>
          ))}
        </ul>
      )}

      {recent.length > 0 && (
        <div className="recent">
          <p className="muted">Recent</p>
          <div className="chip-row">
            {recent.map((c) => (
              <button key={c.label} type="button" className="chip ghost" onClick={() => selectRecent(c)}>
                {c.label.split(',').slice(0, 2).join(',')}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="map-shell">
        <button
          type="button"
          className="map-locate-btn btn ghost"
          onClick={runGeolocation}
          disabled={locating}
          title="Use my location"
          aria-label="Use my location"
        >
          {locating ? '…' : '⌖'}
        </button>
        <MapContainer
          key={mapKey}
          center={mapCenter}
          zoom={draft ? 12 : 11}
          className="city-map"
          scrollWheelZoom
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <BoundsWatcher
            onBounds={(bounds, center) => {
              setDraft((prev) => ({
                label: prev?.label ?? `${center.lat.toFixed(3)}, ${center.lon.toFixed(3)}`,
                center,
                bounds,
                source: 'map',
              }))
            }}
          />
          {rectBounds && (
            <Rectangle
              bounds={rectBounds}
              pathOptions={{ color: '#9a7b52', weight: 2, fillOpacity: 0.08 }}
            />
          )}
        </MapContainer>
        <p className="map-hint">Pan and zoom — the visible area becomes your search box.</p>
      </div>

      <div className="step-actions row">
        <button type="button" className="btn primary" onClick={() => void confirmMapArea()}>
          Use this location
        </button>
        {draft && <p className="muted selected-label">{draft.label}</p>}
      </div>
    </section>
  )
}
