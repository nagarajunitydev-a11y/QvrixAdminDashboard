import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { Site, LocationLog } from '@/types'
import type { EmployeeWithRelations } from '@/api/services'
import { EmptyState } from './PageState'

export function WorkforceMap({
  sites,
  logs,
  employees,
  selectedUser = '',
  selectionRevision = 0,
}: {
  sites: Site[]
  logs: LocationLog[]
  employees: EmployeeWithRelations[]
  selectedUser?: string
  selectionRevision?: number
}) {
  const container = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const layerRef = useRef<L.LayerGroup | null>(null)
  const fitted = useRef(false)
  const [tileError, setTileError] = useState(false)
  useEffect(() => {
    if (!container.current) return
    const map = L.map(container.current, {
      scrollWheelZoom: false,
      zoomControl: false,
    }).setView([20, 0], 2)
    L.control.zoom({ position: 'bottomright' }).addTo(map)
    const tileLayer = L.tileLayer(
      'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      {
        maxZoom: 19,
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      },
    ).addTo(map)
    tileLayer.on('tileerror', () => setTileError(true))
    tileLayer.on('tileload', () => setTileError(false))
    layerRef.current = L.layerGroup().addTo(map)
    mapRef.current = map
    const observer = new ResizeObserver(() => map.invalidateSize())
    observer.observe(container.current)
    return () => {
      observer.disconnect()
      map.remove()
      mapRef.current = null
      fitted.current = false
    }
  }, [])
  useEffect(() => {
    const map = mapRef.current
    const layer = layerRef.current
    if (!map || !layer) return
    layer.clearLayers()
    const points: L.LatLngTuple[] = []
    const valid = (lat: number, lng: number) =>
      Number.isFinite(lat) &&
      Number.isFinite(lng) &&
      Math.abs(lat) <= 90 &&
      Math.abs(lng) <= 180
    sites.forEach((site) => {
      if (!valid(site.latitude, site.longitude)) return
      const point: L.LatLngTuple = [site.latitude, site.longitude]
      points.push(point)
      const label = document.createElement('span')
      label.textContent = `${site.name} · ${site.radius_in_meters}m geofence`
      L.circle(point, {
        radius: Math.max(0, site.radius_in_meters),
        color: '#0d9488',
        fillColor: '#0d9488',
        fillOpacity: 0.08,
        weight: 1.5,
        dashArray: '5 5',
      })
        .bindPopup(label)
        .addTo(layer)
    })
    const latest = new Map<string, LocationLog>()
    logs.forEach((log) => {
      if (
        !latest.has(log.user_id) ||
        latest.get(log.user_id)!.timestamp < log.timestamp
      )
        latest.set(log.user_id, log)
    })
    latest.forEach((log) => {
      if (!valid(log.latitude, log.longitude)) return
      const point: L.LatLngTuple = [log.latitude, log.longitude]
      points.push(point)
      const employee = employees.find((e) => e.user_id === log.user_id)
      const name = employee
        ? `${employee.first_name} ${employee.last_name}`
        : `Account ${log.user_id.slice(0, 8)}`
      const popup = document.createElement('div')
      const heading = document.createElement('strong')
      heading.textContent = name
      const detail = document.createElement('p')
      detail.textContent = `${log.is_inside ? 'Inside geofence' : 'Outside geofence'} · ${new Date(log.timestamp).toLocaleString()}`
      popup.append(heading, detail)
      L.marker(point, {
        title: name,
        icon: L.divIcon({
          className: 'employee-map-marker',
          html: `<span style="background:${log.is_inside ? '#0d9488' : '#b7791f'}"></span>`,
          iconSize: [20, 20],
          iconAnchor: [10, 10],
        }),
      })
        .bindPopup(popup)
        .addTo(layer)
      if (selectedUser === log.user_id) map.setView(point, 16)
    })
    if (!fitted.current && points.length) {
      map.fitBounds(L.latLngBounds(points).pad(0.3), { maxZoom: 15 })
      fitted.current = true
    }
  }, [sites, logs, employees, selectedUser, selectionRevision])
  return (
    <div className="relative h-full min-h-[320px] bg-muted">
      <div
        ref={container}
        className="absolute inset-0 z-0"
        role="region"
        aria-label="Employee locations and site geofences. Use arrow keys to pan and plus or minus to zoom."
      />
      {sites.length === 0 && logs.length === 0 && (
        <div className="absolute inset-0 z-[1] flex items-center justify-center bg-background/90">
          <EmptyState
            title="Your workforce, on the map"
            description="Add a site or wait for employee location updates to see your live workspace."
          />
        </div>
      )}
      {tileError && (
        <p
          role="status"
          className="absolute left-3 top-3 z-[2] rounded-lg border bg-card p-3 text-xs"
        >
          Map tiles couldn’t load. Locations are still available in the list.
        </p>
      )}
      <div className="pointer-events-none absolute bottom-5 left-4 z-[2] flex gap-4 rounded-lg border bg-card/95 px-3 py-2 text-[10px] shadow-sm">
        <span className="flex items-center gap-1.5">
          <i className="h-2 w-2 rounded-full bg-teal-600" />
          Inside site
        </span>
        <span className="flex items-center gap-1.5">
          <i className="h-2 w-2 rounded-full bg-amber-600" />
          Outside site
        </span>
        <span className="hidden items-center gap-1.5 sm:flex">
          <i className="h-3 w-3 rounded-full border border-dashed border-teal-600" />
          Geofence
        </span>
      </div>
    </div>
  )
}
