export type LatLng = { lat: number; lng: number }

const EARTH_RADIUS_M = 6_371_008.8

export function clampLatitude(lat: number) {
  return Math.max(-85.05112878, Math.min(85.05112878, lat))
}

export function normalizeLongitude(lng: number) {
  return ((((lng + 180) % 360) + 360) % 360) - 180
}

export function haversineMeters(a: LatLng, b: LatLng) {
  const toRad = (value: number) => (value * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)))
}

export function centroidOf(points: LatLng[]): LatLng | null {
  if (points.length === 0) return null
  const total = points.reduce(
    (acc, point) => ({ lat: acc.lat + point.lat, lng: acc.lng + point.lng }),
    { lat: 0, lng: 0 }
  )
  return { lat: total.lat / points.length, lng: total.lng / points.length }
}

export function maxDistanceFrom(center: LatLng, points: LatLng[]) {
  return points.reduce((max, point) => Math.max(max, haversineMeters(center, point)), 0)
}

export function formatCoordinate(value: number, digits = 6) {
  return value.toFixed(digits)
}

export function formatRadius(meters: number) {
  if (!Number.isFinite(meters)) return '—'
  if (meters >= 1000) return `${(meters / 1000).toFixed(meters % 1000 === 0 ? 0 : 2)} km`
  return `${Math.round(meters)} m`
}

export function formatArea(squareMeters: number) {
  if (!Number.isFinite(squareMeters)) return '—'
  if (squareMeters >= 1_000_000) return `${(squareMeters / 1_000_000).toFixed(2)} km²`
  if (squareMeters >= 10_000) return `${(squareMeters / 10_000).toFixed(2)} ha`
  return `${Math.round(squareMeters).toLocaleString()} m²`
}

export function circleArea(radiusMeters: number) {
  return Math.PI * radiusMeters * radiusMeters
}
