import { lazy, Suspense, useEffect, useState } from 'react'
import {
  cityCuisineFallbackLinks,
  googleMapsUrl,
  menuOrWebsiteUrl,
  tripadvisorUrl,
  yelpUrl,
} from '../lib/links'
import type { PlaceRatings } from '../lib/ratings'
import { isProbablyOpenNow } from '../lib/rank'
import type { SeedOilInfo } from '../lib/seedOil'
import type { RankedRestaurant } from '../lib/types'
import { RatingsRow } from './RatingsRow'

const ResultsMap = lazy(() =>
  import('./ResultsMap').then((m) => ({ default: m.ResultsMap })),
)

type Props = {
  places: RankedRestaurant[]
  cityLabel: string
  cityCenter: { lat: number; lon: number }
  cuisineLabels: string[]
  keyword?: string
  loading: boolean
  error: string | null
  openNowOnly: boolean
  hasWebsiteOnly: boolean
  ratingsMap: Record<string, PlaceRatings>
  ratingsLoading: boolean
  seedOilMap: Record<string, SeedOilInfo>
  seedOilLoading: boolean
  showSeedOil: boolean
  dishesMap: Record<string, string[]>
  dishesLoading: boolean
  favoriteIds: Set<string>
  onToggleFavorite: (place: RankedRestaurant) => void
  onSearchAgain: () => void
  onToggleOpenNow: () => void
  onToggleWebsite: () => void
  onLove: (place: RankedRestaurant) => void
  onSkip: (place: RankedRestaurant) => void
  onShortlist: (place: RankedRestaurant) => void
  onRetry: () => void
  onCopySearchLink: () => void
  shareMessage: string | null
  shortlistedIds: Set<string>
  lovedIds: Set<string>
  onBack: () => void
  onNewSearch: () => void
}

export function ResultsStep({
  places,
  cityLabel,
  cityCenter,
  cuisineLabels,
  keyword,
  loading,
  error,
  openNowOnly,
  hasWebsiteOnly,
  ratingsMap,
  ratingsLoading,
  seedOilMap,
  seedOilLoading,
  showSeedOil,
  dishesMap,
  dishesLoading,
  favoriteIds,
  onToggleFavorite,
  onSearchAgain,
  onToggleOpenNow,
  onToggleWebsite,
  onLove,
  onSkip,
  onShortlist,
  onRetry,
  onCopySearchLink,
  shareMessage,
  shortlistedIds,
  lovedIds,
  onBack,
  onNewSearch,
}: Props) {
  const filtered = places.filter((p) => {
    if (hasWebsiteOnly && !p.website) return false
    if (openNowOnly) {
      const open = isProbablyOpenNow(p.openingHours)
      if (open === false) return false
    }
    return true
  })

  const favoriteCount = places.filter((p) => favoriteIds.has(p.id)).length
  const fallback = cityCuisineFallbackLinks(cityLabel, cuisineLabels, keyword)
  const [mapReady, setMapReady] = useState(false)

  useEffect(() => {
    if (loading || filtered.length === 0) {
      setMapReady(false)
      return
    }
    const id = window.setTimeout(() => setMapReady(true), 0)
    return () => window.clearTimeout(id)
  }, [loading, filtered.length])

  return (
    <section className="step results-step">
      <header className="step-header">
        <p className="eyebrow">Your top picks · {cityLabel}</p>
        <h2>Ten places worth checking</h2>
        <p className="lede">
          Ranked from OpenStreetMap for your area and taste
          {keyword ? (
            <>
              {' '}
              with a boost for <strong>{keyword}</strong>
            </>
          ) : null}
          . Star <strong>Favorite</strong> places you want to keep, then{' '}
          <strong>Find more restaurants</strong> to swap out the rest for fresh options.
        </p>
      </header>

      {shareMessage && <p className="banner">{shareMessage}</p>}

      <div className="filters chip-row wrap">
        <button type="button" className={`chip ghost ${openNowOnly ? 'on' : ''}`} onClick={onToggleOpenNow}>
          Prefer open now
        </button>
        <button
          type="button"
          className={`chip ghost ${hasWebsiteOnly ? 'on' : ''}`}
          onClick={onToggleWebsite}
        >
          Has website
        </button>
        <button type="button" className="chip ghost" onClick={onCopySearchLink}>
          Copy search link
        </button>
        {!loading && filtered.length > 0 && (
          <button type="button" className="chip primary" onClick={onSearchAgain}>
            Find more restaurants{favoriteCount > 0 ? ` (keep ${favoriteCount} favorite${favoriteCount === 1 ? '' : 's'})` : ''}
          </button>
        )}
      </div>

      {loading && (
        <div className="skeleton-stack" aria-live="polite">
          <p className="muted">Searching this neighborhood on OpenStreetMap…</p>
          {[0, 1, 2].map((i) => (
            <div key={i} className="skeleton-card" />
          ))}
        </div>
      )}

      {error && !loading && (
        <div className="empty-state">
          <p>{error}</p>
          <div className="chip-row wrap">
            <button type="button" className="btn primary" onClick={onRetry}>
              Try again
            </button>
            <a className="btn ghost" href={fallback.google} target="_blank" rel="noreferrer">
              Google Maps
            </a>
            <a className="btn ghost" href={fallback.yelp} target="_blank" rel="noreferrer">
              Yelp
            </a>
            <a className="btn ghost" href={fallback.tripadvisor} target="_blank" rel="noreferrer">
              TripAdvisor
            </a>
          </div>
        </div>
      )}

      {!loading && !error && filtered.length === 0 && (
        <div className="empty-state">
          <p>
            Map data looks thin here for those cuisines. Zoom to a denser neighborhood, try different
            food types, or jump to Google / Yelp / TripAdvisor for this city.
          </p>
          <div className="chip-row wrap">
            <a className="btn primary" href={fallback.google} target="_blank" rel="noreferrer">
              Google
            </a>
            <a className="btn ghost" href={fallback.yelp} target="_blank" rel="noreferrer">
              Yelp
            </a>
            <a className="btn ghost" href={fallback.tripadvisor} target="_blank" rel="noreferrer">
              TripAdvisor
            </a>
          </div>
        </div>
      )}

      {!loading && !error && filtered.length > 0 && mapReady && (
        <Suspense fallback={null}>
          <ResultsMap places={filtered} center={cityCenter} />
        </Suspense>
      )}

      <ol className="result-list">
        {filtered.map((place, index) => {
          const menu = menuOrWebsiteUrl(place, cityLabel)
          const ratings = ratingsMap[place.id] ?? null
          const seedOil = seedOilMap[place.id]
          const dishes = dishesMap[place.id]
          const isFavorite = favoriteIds.has(place.id)
          return (
            <li key={place.id} className={`result-card${isFavorite ? ' result-card--favorite' : ''}`}>
              <div className="result-rank">{index + 1}</div>
              <div className="result-body">
                <h3>
                  {place.name}
                  {isFavorite && <span className="favorite-badge">Favorite</span>}
                </h3>
                <p className="meta">
                  {place.cuisines.slice(0, 3).join(' · ') || place.amenity || 'Restaurant'}
                  {ratings?.price.label ? (
                    <>
                      {' · '}
                      <span className="price-range" title="Typical price range">
                        {ratings.price.label}
                      </span>
                    </>
                  ) : ratingsLoading ? (
                    <> · <span className="muted">price…</span></>
                  ) : null}
                  {place.distanceKm < 50 ? ` · ${place.distanceKm.toFixed(1)} km` : ''}
                  {place.address ? ` · ${place.address}` : ''}
                  {place.phone ? (
                    <>
                      {' · '}
                      <a href={`tel:${place.phone.replace(/\s/g, '')}`}>{place.phone}</a>
                    </>
                  ) : null}
                </p>
                <RatingsRow ratings={ratings} loading={ratingsLoading && !ratings} />
                {seedOil?.grade ? (
                  <p className="seed-oil-badge">
                    <a href={seedOil.url} target="_blank" rel="noreferrer" title={seedOil.cookingOil ?? undefined}>
                      Seed Oil Tracker: grade {seedOil.grade}
                      {seedOil.risk ? ` · ${seedOil.risk}` : ''}
                      {seedOil.chain ? ` · ${seedOil.chain}` : ''}
                    </a>
                  </p>
                ) : seedOilLoading && showSeedOil ? (
                  <p className="seed-oil-badge muted">Checking seed-oil data…</p>
                ) : null}
                {dishes?.length ? (
                  <p className="popular-dishes">
                    <span className="popular-dishes-label">Popular dishes</span>
                    {dishes.join(' · ')}
                  </p>
                ) : dishesLoading ? (
                  <p className="popular-dishes muted">Loading popular dishes…</p>
                ) : null}
                <ul className="reasons">
                  {place.reasons.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
                <div className="link-row">
                  <a href={googleMapsUrl(place, cityLabel)} target="_blank" rel="noreferrer">
                    Google reviews
                  </a>
                  <a href={yelpUrl(place, cityLabel)} target="_blank" rel="noreferrer">
                    Yelp
                  </a>
                  <a href={tripadvisorUrl(place, cityLabel)} target="_blank" rel="noreferrer">
                    TripAdvisor
                  </a>
                  <a href={menu.href} target="_blank" rel="noreferrer">
                    {menu.label}
                  </a>
                </div>
                <div className="card-actions">
                  <button
                    type="button"
                    className={`btn tiny ${isFavorite ? 'primary' : 'ghost'}`}
                    onClick={() => onToggleFavorite(place)}
                  >
                    {isFavorite ? '★ Favorited' : '☆ Favorite'}
                  </button>
                  <button
                    type="button"
                    className={`btn tiny ${lovedIds.has(place.id) ? 'primary' : 'ghost'}`}
                    onClick={() => onLove(place)}
                  >
                    Loved it
                  </button>
                  <button type="button" className="btn tiny ghost" onClick={() => onSkip(place)}>
                    Not for me
                  </button>
                  <button
                    type="button"
                    className={`btn tiny ${shortlistedIds.has(place.id) ? 'primary' : 'ghost'}`}
                    onClick={() => onShortlist(place)}
                  >
                    {shortlistedIds.has(place.id) ? 'Shortlisted' : 'Shortlist'}
                  </button>
                </div>
              </div>
            </li>
          )
        })}
      </ol>

      <div className="step-actions row">
        {!loading && filtered.length > 0 && (
          <button type="button" className="btn primary" onClick={onSearchAgain}>
            Find more restaurants
          </button>
        )}
        <button type="button" className="btn ghost" onClick={onBack}>
          Change food
        </button>
        <button type="button" className="btn ghost" onClick={onNewSearch}>
          New city
        </button>
      </div>
    </section>
  )
}
