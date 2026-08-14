import { CUISINES, CUISINE_GROUPS, DIETARY_OPTIONS } from '../data/cuisines'
import { KEYWORD_SUGGESTIONS } from '../lib/keyword'
import type { CuisineId, DietaryId } from '../lib/types'

type Props = {
  selected: CuisineId[]
  dietary: DietaryId[]
  keyword: string
  onChange: (cuisines: CuisineId[]) => void
  onDietaryChange: (dietary: DietaryId[]) => void
  onKeywordChange: (keyword: string) => void
  onBack: () => void
  onNext: () => void
  cityLabel: string
}

export function CuisineStep({
  selected,
  dietary,
  keyword,
  onChange,
  onDietaryChange,
  onKeywordChange,
  onBack,
  onNext,
  cityLabel,
}: Props) {
  function toggle(id: CuisineId) {
    if (selected.includes(id)) {
      onChange(selected.filter((c) => c !== id))
      return
    }
    if (selected.length >= 3) return
    onChange([...selected, id])
  }

  function toggleDiet(id: DietaryId) {
    if (dietary.includes(id)) onDietaryChange(dietary.filter((d) => d !== id))
    else onDietaryChange([...dietary, id])
  }

  return (
    <section className="step cuisine-step">
      <header className="step-header">
        <p className="eyebrow">Step 2 · {cityLabel}</p>
        <h2>What are you craving?</h2>
        <p className="lede">
          Pick up to three food types — salmon, steak, salad, smoothies, and more. Dietary boosts are
          optional soft signals, not hard filters.
        </p>
      </header>

      {CUISINE_GROUPS.map((group) => (
        <div key={group.id} className="cuisine-group">
          <h3 className="subhead">{group.label}</h3>
          <div className="chip-row wrap">
            {CUISINES.filter((c) => c.group === group.id).map((c) => {
              const on = selected.includes(c.id)
              const disabled = !on && selected.length >= 3
              return (
                <button
                  key={c.id}
                  type="button"
                  className={`chip ${on ? 'on' : ''}`}
                  disabled={disabled}
                  onClick={() => toggle(c.id)}
                >
                  {c.label}
                </button>
              )
            })}
          </div>
        </div>
      ))}
      <p className="muted">{selected.length}/3 selected</p>

      <h3 className="subhead">Dietary boosts</h3>
      <div className="chip-row wrap">
        {DIETARY_OPTIONS.map((d) => (
          <button
            key={d.id}
            type="button"
            className={`chip ghost ${dietary.includes(d.id) ? 'on' : ''}`}
            onClick={() => toggleDiet(d.id)}
            title={d.hint}
          >
            {d.label}
          </button>
        ))}
      </div>
      {dietary.includes('no_seed_oils') && (
        <p className="muted small">
          Seed-oil grades from{' '}
          <a href="https://seedoiltracker.com" target="_blank" rel="noreferrer">
            Seed Oil Tracker
          </a>{' '}
          when the place matches a known chain. Seed Oil Scout has no public API — we use Seed Oil Tracker
          instead.
        </p>
      )}

      <h3 className="subhead">Specific keyword</h3>
      <p className="muted small">
        Optional — boosts places whose name or listing mentions your phrase (e.g. wild caught fish, grass fed
        steak). Soft signal, not a hard filter.
      </p>
      <label className="field">
        <span>Keyword or phrase</span>
        <input
          value={keyword}
          onChange={(e) => onKeywordChange(e.target.value)}
          placeholder='e.g. "wild caught fish" or "organic fruit"'
          autoComplete="off"
        />
      </label>
      <div className="chip-row wrap">
        {KEYWORD_SUGGESTIONS.map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            className={`chip ghost ${keyword.toLowerCase() === suggestion ? 'on' : ''}`}
            onClick={() => onKeywordChange(keyword.toLowerCase() === suggestion ? '' : suggestion)}
          >
            {suggestion}
          </button>
        ))}
      </div>

      <div className="step-actions row">
        <button type="button" className="btn ghost" onClick={onBack}>
          Back
        </button>
        <button type="button" className="btn primary" disabled={selected.length === 0} onClick={onNext}>
          Find 10 places
        </button>
      </div>
    </section>
  )
}
