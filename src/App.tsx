import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { HashRouter, Link, Navigate, Route, Routes, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { cuisineById, isKnownCuisineId, isKnownDietaryId } from './data/cuisines'
import { usePlaceDishes } from './hooks/usePlaceDishes'
import { usePlaceRatings } from './hooks/usePlaceRatings'
import { usePlaceSeedOil } from './hooks/usePlaceSeedOil'
import { buildSearchShareUrl } from './lib/links'
import { ensureCacheGeneration, pruneExpiredCache } from './lib/storage'
import { fetchRestaurants } from './lib/overpass'
import { rankRestaurants } from './lib/rank'
import { seedOilGradeScore } from './lib/seedOil'
import {
  loadShortlist,
  loadTaste,
  lovePlace,
  saveShortlist,
  setDietaryPrefs,
  skipPlace,
  toggleShortlist,
  type ShortlistItem,
} from './lib/taste'
import type { CitySelection, CuisineId, DietaryId, RankedRestaurant, Restaurant, TasteProfile } from './lib/types'
import { CuisineStep } from './components/CuisineStep'
import { ResultsStep } from './components/ResultsStep'
import { SettingsPage } from './components/SettingsPage'
import { TastePage } from './components/TastePage'
import './App.css'

const CityStep = lazy(() =>
  import('./components/CityStep').then((m) => ({ default: m.CityStep })),
)

function cityFromParams(params: URLSearchParams): CitySelection | null {
  const label = params.get('city')
  const lat = Number(params.get('lat'))
  const lon = Number(params.get('lon'))
  const south = Number(params.get('south'))
  const west = Number(params.get('west'))
  const north = Number(params.get('north'))
  const east = Number(params.get('east'))
  if (!label || ![lat, lon, south, west, north, east].every((n) => Number.isFinite(n))) return null
  return {
    label,
    center: { lat, lon },
    bounds: { south, west, north, east },
    source: 'search',
  }
}

function useTaste() {
  const [taste, setTaste] = useState<TasteProfile>(() => loadTaste())
  return { taste, setTaste }
}

function SearchFlow() {
  const [params, setParams] = useSearchParams()
  const { taste, setTaste } = useTaste()
  const restored = cityFromParams(params)
  const initialCuisines = useMemo(() => {
    const c = params.get('cuisines')
    if (!c) return [] as CuisineId[]
    return c
      .split(',')
      .filter((id) => isKnownCuisineId(id))
      .slice(0, 3) as CuisineId[]
  }, [params])

  const [step, setStep] = useState<'city' | 'cuisine' | 'results'>(() => {
    if (restored && initialCuisines.length) return 'results'
    if (restored) return 'cuisine'
    return 'city'
  })
  const [city, setCity] = useState<CitySelection | null>(() => restored)
  const [cuisines, setCuisines] = useState<CuisineId[]>(() => initialCuisines)
  const [dietary, setDietary] = useState<DietaryId[]>(() => {
    const d = params.get('dietary')
    if (d) return d.split(',').filter((id) => isKnownDietaryId(id)) as DietaryId[]
    return taste.dietaryPrefs
  })
  const [keyword, setKeyword] = useState(() => params.get('keyword') ?? '')
  const [rawPlaces, setRawPlaces] = useState<Restaurant[]>([])
  const [displayPlaces, setDisplayPlaces] = useState<RankedRestaurant[]>([])
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(() => new Set())
  const [seenIds, setSeenIds] = useState<Set<string>>(() => new Set())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [openNowOnly, setOpenNowOnly] = useState(false)
  const [hasWebsiteOnly, setHasWebsiteOnly] = useState(false)
  const [shortlist, setShortlist] = useState<ShortlistItem[]>(() => loadShortlist())
  const [shareMessage, setShareMessage] = useState<string | null>(null)
  const searchAbortRef = useRef<AbortController | null>(null)
  const prefetchPromiseRef = useRef<Promise<Restaurant[]> | null>(null)
  const poolRef = useRef<Restaurant[]>([])
  const autoRanRef = useRef(false)
  const seedOilBoostRef = useRef(false)
  const tasteRef = useRef(taste)
  tasteRef.current = taste

  const places = displayPlaces

  const { ratingsMap, ratingsLoading } = usePlaceRatings(places, city?.label ?? '', step === 'results' && places.length > 0)
  const { seedOilMap, seedOilLoading } = usePlaceSeedOil(
    places,
    step === 'results' && places.length > 0 && dietary.includes('no_seed_oils'),
  )
  const { dishesMap, dishesLoading } = usePlaceDishes(
    places,
    city?.label ?? '',
    cuisines,
    step === 'results' && places.length > 0,
  )

  useEffect(() => {
    return () => {
      searchAbortRef.current?.abort()
    }
  }, [])

  useEffect(() => {
    if (!dietary.includes('no_seed_oils') || seedOilLoading || displayPlaces.length === 0) return
    if (seedOilBoostRef.current) return
    const hasGrade = displayPlaces.some((p) => seedOilMap[p.id]?.grade)
    if (!hasGrade) return

    seedOilBoostRef.current = true
    setDisplayPlaces((prev) => {
      const updated = prev.map((p) => {
        const info = seedOilMap[p.id]
        if (!info?.grade) return p
        const boost = seedOilGradeScore(info.grade)
        if (boost === 0) return p
        const reasons = [...p.reasons]
        const msg =
          boost > 0
            ? `Seed Oil Tracker grade ${info.grade} — lower seed-oil risk`
            : `Seed Oil Tracker grade ${info.grade} — higher seed-oil use`
        if (!reasons.some((r) => r.includes('Seed Oil Tracker'))) reasons.unshift(msg)
        return { ...p, score: p.score + boost, reasons: reasons.slice(0, 4) }
      })
      return [...updated].sort((a, b) => b.score - a.score)
    })
  }, [dietary, seedOilMap, seedOilLoading, displayPlaces.length])

  const runSearch = useCallback(
    async (selection: CitySelection, food: CuisineId[], dietaryPrefs: DietaryId[], searchKeyword: string) => {
      const ctrl = new AbortController()
      searchAbortRef.current?.abort()
      searchAbortRef.current = ctrl
      setError(null)
      setStep('results')
      seedOilBoostRef.current = false
      setFavoriteIds(new Set())
      setSeenIds(new Set())

      const rankPool = (raw: Restaurant[]) => {
        poolRef.current = raw
        setRawPlaces(raw)
        const ranked = rankRestaurants(raw, {
          center: selection.center,
          selectedCuisines: food,
          dietary: dietaryPrefs,
          keyword: searchKeyword,
          taste: tasteRef.current,
          limit: 10,
        })
        setDisplayPlaces(ranked)
        setSeenIds(new Set(ranked.map((p) => p.id)))
        setLoading(false)
      }

      if (poolRef.current.length) {
        rankPool(poolRef.current)
        return
      }

      setLoading(true)
      setDisplayPlaces([])
      try {
        const raw = await (prefetchPromiseRef.current ?? fetchRestaurants(selection.bounds, ctrl.signal))
        if (ctrl.signal.aborted) return
        rankPool(raw)
      } catch (e) {
        if ((e as Error).name === 'AbortError' || ctrl.signal.aborted) return
        setError('Could not reach OpenStreetMap right now. Try again in a minute, or use Google / Yelp below.')
        setRawPlaces([])
        setDisplayPlaces([])
        setLoading(false)
      }
    },
    [],
  )

  const searchAgain = useCallback(async () => {
    if (!city || cuisines.length === 0) return
    searchAbortRef.current?.abort()
    const ctrl = new AbortController()
    searchAbortRef.current = ctrl
    seedOilBoostRef.current = false
    setLoading(true)
    setError(null)

    const favorites = displayPlaces.filter((p) => favoriteIds.has(p.id))
    const nextSeen = new Set(seenIds)
    displayPlaces.forEach((p) => {
      if (!favoriteIds.has(p.id)) nextSeen.add(p.id)
    })

    try {
      let pool = poolRef.current.length ? poolRef.current : rawPlaces
      if (pool.length === 0) {
        pool = await (prefetchPromiseRef.current ?? fetchRestaurants(city.bounds, ctrl.signal))
        if (ctrl.signal.aborted) return
        poolRef.current = pool
        setRawPlaces(pool)
      }

      const slots = Math.max(0, 10 - favorites.length)
      const fresh =
        slots > 0
          ? rankRestaurants(pool, {
              center: city.center,
              selectedCuisines: cuisines,
              dietary,
              keyword,
              taste,
              limit: slots + 15,
              excludeIds: nextSeen,
            }).slice(0, slots)
          : []

      fresh.forEach((p) => nextSeen.add(p.id))
      setDisplayPlaces([...favorites, ...fresh])
      setSeenIds(nextSeen)
      setFavoriteIds(new Set(favorites.map((p) => p.id)))
    } catch (e) {
      if ((e as Error).name === 'AbortError' || ctrl.signal.aborted) return
      setError('Could not fetch more places. Try again in a minute.')
    } finally {
      if (!ctrl.signal.aborted) setLoading(false)
    }
  }, [city, cuisines, dietary, keyword, taste, displayPlaces, favoriteIds, seenIds, rawPlaces])

  useEffect(() => {
    if (!city || prefetchPromiseRef.current) return
    prefetchPromiseRef.current = fetchRestaurants(city.bounds).then((raw) => {
      poolRef.current = raw
      setRawPlaces(raw)
      return raw
    })
  }, [city])

  // Auto-run when shared URL has city + cuisines
  useEffect(() => {
    if (autoRanRef.current || !restored || initialCuisines.length === 0) return
    autoRanRef.current = true
    void runSearch(restored, initialCuisines, dietary, keyword)
  }, [restored, initialCuisines, dietary, keyword, runSearch])

  function confirmCity(selection: CitySelection) {
    setCity(selection)
    setStep('cuisine')
    poolRef.current = []
    setRawPlaces([])
    prefetchPromiseRef.current = fetchRestaurants(selection.bounds).then((raw) => {
      poolRef.current = raw
      setRawPlaces(raw)
      return raw
    })
    setParams((prev) => {
      const next = new URLSearchParams(prev)
      next.set('city', selection.label)
      next.set('lat', String(selection.center.lat))
      next.set('lon', String(selection.center.lon))
      next.set('south', String(selection.bounds.south))
      next.set('west', String(selection.bounds.west))
      next.set('north', String(selection.bounds.north))
      next.set('east', String(selection.bounds.east))
      return next
    })
  }

  function startFind() {
    if (!city || cuisines.length === 0) return
    setTaste(setDietaryPrefs(taste, dietary))
    setParams((prev) => {
      const next = new URLSearchParams(prev)
      next.set('cuisines', cuisines.join(','))
      next.set('dietary', dietary.join(','))
      const trimmed = keyword.trim()
      if (trimmed) next.set('keyword', trimmed)
      else next.delete('keyword')
      return next
    })
    void runSearch(city, cuisines, dietary, keyword)
  }

  async function copySearchLink() {
    try {
      await navigator.clipboard.writeText(buildSearchShareUrl(params))
      setShareMessage('Search link copied — send it to a friend!')
    } catch {
      setShareMessage(buildSearchShareUrl(params))
    }
  }

  const cuisineLabels = useMemo(
    () => cuisines.map((id) => cuisineById(id).label),
    [cuisines],
  )

  const lovedIds = useMemo(() => new Set(taste.loved.map((l) => l.id)), [taste.loved])
  const shortlistedIds = useMemo(() => new Set(shortlist.map((s) => s.id)), [shortlist])

  return (
    <>
      {step === 'city' && (
        <Suspense fallback={<p className="muted">Loading map…</p>}>
          <CityStep onConfirm={confirmCity} initial={city} />
        </Suspense>
      )}
      {step === 'cuisine' && city && (
        <CuisineStep
          cityLabel={city.label}
          selected={cuisines}
          dietary={dietary}
          keyword={keyword}
          onChange={setCuisines}
          onDietaryChange={setDietary}
          onKeywordChange={setKeyword}
          onBack={() => setStep('city')}
          onNext={startFind}
        />
      )}
      {step === 'results' && city && (
        <ResultsStep
          places={places}
          cityLabel={city.label}
          cityCenter={city.center}
          cuisineLabels={cuisineLabels}
          keyword={keyword.trim() || undefined}
          loading={loading}
          error={error}
          openNowOnly={openNowOnly}
          hasWebsiteOnly={hasWebsiteOnly}
          ratingsMap={ratingsMap}
          ratingsLoading={ratingsLoading}
          seedOilMap={seedOilMap}
          seedOilLoading={seedOilLoading}
          showSeedOil={dietary.includes('no_seed_oils')}
          dishesMap={dishesMap}
          dishesLoading={dishesLoading}
          favoriteIds={favoriteIds}
          onToggleFavorite={(place) => {
            setFavoriteIds((prev) => {
              const next = new Set(prev)
              if (next.has(place.id)) next.delete(place.id)
              else next.add(place.id)
              return next
            })
          }}
          onSearchAgain={() => void searchAgain()}
          onToggleOpenNow={() => setOpenNowOnly((v) => !v)}
          onToggleWebsite={() => setHasWebsiteOnly((v) => !v)}
          lovedIds={lovedIds}
          shortlistedIds={shortlistedIds}
          shareMessage={shareMessage}
          onCopySearchLink={() => void copySearchLink()}
          onRetry={() => void runSearch(city, cuisines, dietary, keyword)}
          onLove={(place) => {
            setTaste(
              lovePlace(taste, {
                id: place.id,
                name: place.name,
                city: city.label,
                cuisines: place.cuisines,
                rating: 5,
                vibeTags: [],
              }),
            )
          }}
          onSkip={(place) => {
            setTaste(
              skipPlace(taste, {
                id: place.id,
                name: place.name,
                city: city.label,
                cuisines: place.cuisines,
                rating: 1,
                vibeTags: [],
              }),
            )
            setRawPlaces((prev) => prev.filter((p) => p.id !== place.id))
            setDisplayPlaces((prev) => prev.filter((p) => p.id !== place.id))
            setFavoriteIds((prev) => {
              if (!prev.has(place.id)) return prev
              const next = new Set(prev)
              next.delete(place.id)
              return next
            })
            setSeenIds((prev) => new Set(prev).add(place.id))
          }}
          onShortlist={(place) => {
            setShortlist(
              toggleShortlist(shortlist, {
                id: place.id,
                name: place.name,
                lat: place.lat,
                lon: place.lon,
                city: city.label,
              }),
            )
          }}
          onBack={() => setStep('cuisine')}
          onNewSearch={() => {
            setStep('city')
            setRawPlaces([])
            setDisplayPlaces([])
            setFavoriteIds(new Set())
            setSeenIds(new Set())
            poolRef.current = []
            prefetchPromiseRef.current = null
            autoRanRef.current = false
          }}
        />
      )}
    </>
  )
}

function TasteRoute() {
  const { taste, setTaste } = useTaste()
  const [shortlist, setShortlist] = useState<ShortlistItem[]>(() => loadShortlist())
  const shareUrl = useMemo(() => {
    const payload = encodeURIComponent(JSON.stringify(shortlist))
    return `${window.location.origin}${window.location.pathname}#/shortlist?data=${payload}`
  }, [shortlist])

  return (
    <TastePage
      taste={taste}
      onTasteChange={setTaste}
      shortlist={shortlist}
      onClearShortlist={() => {
        saveShortlist([])
        setShortlist([])
      }}
      shareUrl={shareUrl}
    />
  )
}

function ShortlistView() {
  const [params] = useSearchParams()
  const items = useMemo(() => {
    try {
      const raw = params.get('data')
      if (!raw) return []
      return JSON.parse(decodeURIComponent(raw)) as ShortlistItem[]
    } catch {
      return []
    }
  }, [params])

  return (
    <section className="step">
      <header className="step-header">
        <p className="eyebrow">Shared shortlist</p>
        <h2>Places to try</h2>
      </header>
      {items.length === 0 ? (
        <p className="muted">No places in this link.</p>
      ) : (
        <ul className="taste-list">
          {items.map((i) => (
            <li key={i.id}>
              <strong>{i.name}</strong>
              {i.city && <span className="muted"> · {i.city}</span>}
            </li>
          ))}
        </ul>
      )}
      <Link className="btn primary" to="/">
        Start your own search
      </Link>
    </section>
  )
}

function SearchRoute() {
  const location = useLocation()
  const reset = (location.state as { reset?: number } | null)?.reset ?? 0
  return <SearchFlow key={reset} />
}

function Shell() {
  const navigate = useNavigate()

  useEffect(() => {
    ensureCacheGeneration()
    pruneExpiredCache()
  }, [])

  function goHome() {
    navigate('/', { replace: true, state: { reset: Date.now() } })
  }

  return (
    <div className="app-shell">
      <div className="atmosphere" aria-hidden />
      <header className="topbar">
        <button type="button" className="top-brand" onClick={goHome}>
          OpenPlate
        </button>
        <nav>
          <Link to="/taste">My Taste</Link>
          <Link to="/settings">Settings</Link>
        </nav>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<SearchRoute />} />
          <Route path="/search" element={<Navigate to="/" replace />} />
          <Route path="/taste" element={<TasteRoute />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/shortlist" element={<ShortlistView />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <footer className="site-footer">
        <p>
          Place data ©{' '}
          <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
            OpenStreetMap contributors
          </a>
          . Ratings from Google, Yelp, and TripAdvisor when available. Seed-oil chain grades from{' '}
          <a href="https://seedoiltracker.com" target="_blank" rel="noreferrer">
            Seed Oil Tracker
          </a>
          . Taste profiles stay on your device.
        </p>
      </footer>
    </div>
  )
}

export default function App() {
  return (
    <HashRouter>
      <Shell />
    </HashRouter>
  )
}
