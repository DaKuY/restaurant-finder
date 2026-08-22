import { MapContainer, TileLayer, CircleMarker, Popup } from 'react-leaflet'
import type { RankedRestaurant } from '../lib/types'
import 'leaflet/dist/leaflet.css'

type Props = {
  places: RankedRestaurant[]
  center: { lat: number; lon: number }
}

export function ResultsMap({ places, center }: Props) {
  if (!places.length) return null
  return (
    <div className="map-shell results-map-shell">
      <MapContainer center={[center.lat, center.lon]} zoom={13} className="city-map results-map" scrollWheelZoom={false}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {places.map((p, i) => (
          <CircleMarker
            key={p.id}
            center={[p.lat, p.lon]}
            radius={10}
            pathOptions={{ color: '#9a7b52', fillColor: '#b8956c', fillOpacity: 0.85, weight: 2 }}
          >
            <Popup>
              <strong>
                {i + 1}. {p.name}
              </strong>
            </Popup>
          </CircleMarker>
        ))}
      </MapContainer>
    </div>
  )
}
