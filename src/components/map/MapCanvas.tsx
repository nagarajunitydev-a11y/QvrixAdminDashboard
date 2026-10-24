import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import {
  AlertCircle,
  Check,
  Crosshair,
  Loader2,
  MapPin,
  Minus,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  clampLatitude,
  formatCoordinate,
  normalizeLongitude,
  type LatLng,
} from '@/lib/geo'

const TILE_SIZE = 256
const MIN_ZOOM = 2
const MAX_ZOOM = 19
const TILE_URL = 'https://tile.openstreetmap.org'
const SEARCH_URL = 'https://nominatim.openstreetmap.org/search'

export type MapMarkerTone = 'primary' | 'danger' | 'muted' | 'selected'

export type MapMarker = {
  id: string
  position: LatLng
  label: string
  sublabel?: string
  tone?: MapMarkerTone
  draggable?: boolean
  onClick?: () => void
}

export type MapCircle = {
  id: string
  center: LatLng
  radiusMeters: number
  tone?: 'saved' | 'draft' | 'muted'
  label?: string
}

export type MapPolygon = {
  id: string
  points: LatLng[]
  tone?: 'draft' | 'saved'
}

type SearchResult = {
  placeId: string
  label: string
  position: LatLng
}

type Message = { tone: 'error' | 'info'; text: string }

function projectPoint(point: LatLng, scale: number) {
  const lat = clampLatitude(point.lat)
  const lng = normalizeLongitude(point.lng)
  const x = ((lng + 180) / 360) * scale
  const sinLat = Math.sin((lat * Math.PI) / 180)
  const y =
    (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * scale
  return { x, y }
}

function unprojectPoint(x: number, y: number, scale: number): LatLng {
  const lng = (x / scale) * 360 - 180
  const n = Math.PI - (2 * Math.PI * y) / scale
  const lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)))
  return { lat: clampLatitude(lat), lng: normalizeLongitude(lng) }
}

const markerToneStyles: Record<MapMarkerTone, string> = {
  primary: 'bg-primary text-primary-foreground ring-primary/25',
  danger: 'bg-red-500 text-white ring-red-500/25',
  muted: 'bg-slate-500 text-white ring-slate-500/25',
  selected: 'bg-primary text-primary-foreground ring-primary/40',
}

const circleToneStyles = {
  saved: 'border-primary/40 bg-primary/[0.06]',
  draft: 'border-primary bg-primary/[0.1]',
  muted: 'border-slate-400/40 bg-slate-400/[0.03]',
} as const

export function MapCanvas({
  center,
  zoom = 13,
  markers = [],
  circles = [],
  polygons = [],
  drawing = false,
  onMapClick,
  onMarkerDrag,
  onPolygonVertexDrag,
  onLocate,
  onSearchSelect,
  onClear,
  onSave,
  saveLabel = 'Save geofence',
  saveDisabled = false,
  saving = false,
  showSearch = true,
  showSave = false,
  className,
  ariaLabel = 'Interactive map',
}: {
  center: LatLng
  zoom?: number
  markers?: MapMarker[]
  circles?: MapCircle[]
  polygons?: MapPolygon[]
  drawing?: boolean
  onMapClick?: (position: LatLng) => void
  onMarkerDrag?: (id: string, position: LatLng) => void
  onPolygonVertexDrag?: (polygonId: string, index: number, position: LatLng) => void
  onLocate?: (position: LatLng) => void
  onSearchSelect?: (position: LatLng, label: string) => void
  onClear?: () => void
  onSave?: () => void
  saveLabel?: string
  saveDisabled?: boolean
  saving?: boolean
  showSearch?: boolean
  showSave?: boolean
  className?: string
  ariaLabel?: string
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const initialView = useRef({ center, zoom })
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [view, setView] = useState({ center, zoom })
  const [isPanning, setIsPanning] = useState(false)
  const [cursor, setCursor] = useState<LatLng | null>(null)
  const [tileErrors, setTileErrors] = useState(0)
  const [tileLoaded, setTileLoaded] = useState(0)
  const [searchQuery, setSearchQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [searchState, setSearchState] = useState<'idle' | 'loading' | 'error'>('idle')
  const [searchError, setSearchError] = useState('')
  const [geoState, setGeoState] = useState<'idle' | 'loading'>('idle')
  const [message, setMessage] = useState<Message | null>(null)

  const panRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    centerWorld: { x: number; y: number }
    scale: number
    moved: boolean
  } | null>(null)
  const markerDragRef = useRef<{ id: string; moved: boolean } | null>(null)
  const vertexDragRef = useRef<{ polygonId: string; index: number } | null>(null)

  const controlledRef = useRef({ center, zoom })

  // Sync external center/zoom (e.g. selecting a site in the list).
  useEffect(() => {
    const previous = controlledRef.current
    const centerChanged =
      Math.abs(previous.center.lat - center.lat) > 1e-9 ||
      Math.abs(previous.center.lng - center.lng) > 1e-9
    const zoomChanged = previous.zoom !== zoom
    if (!centerChanged && !zoomChanged) return
    controlledRef.current = { center, zoom }
    setView((current) => ({
      center,
      zoom: zoomChanged ? zoom : current.zoom,
    }))
  }, [center, zoom])

  useEffect(() => {
    const element = containerRef.current
    if (!element) return
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect
      if (rect) setSize({ width: rect.width, height: rect.height })
    })
    observer.observe(element)
    const rect = element.getBoundingClientRect()
    setSize({ width: rect.width, height: rect.height })
    return () => observer.disconnect()
  }, [])

  const world = useMemo(() => {
    if (size.width === 0 || size.height === 0) return null
    const scale = TILE_SIZE * 2 ** view.zoom
    const projected = projectPoint(view.center, scale)
    const topLeft = {
      x: projected.x - size.width / 2,
      y: projected.y - size.height / 2,
    }
    return { scale, topLeft, projected }
  }, [size.width, size.height, view])

  const tiles = useMemo(() => {
    if (!world) return []
    const count = 2 ** view.zoom
    const minX = Math.floor(world.topLeft.x / TILE_SIZE)
    const maxX = Math.floor((world.topLeft.x + size.width) / TILE_SIZE)
    const minY = Math.max(0, Math.floor(world.topLeft.y / TILE_SIZE))
    const maxY = Math.min(count - 1, Math.floor((world.topLeft.y + size.height) / TILE_SIZE))
    const next: Array<{ key: string; src: string; left: number; top: number }> = []
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const wrappedX = ((x % count) + count) % count
        next.push({
          key: `${view.zoom}/${x}/${y}`,
          src: `${TILE_URL}/${view.zoom}/${wrappedX}/${y}.png`,
          left: x * TILE_SIZE - world.topLeft.x,
          top: y * TILE_SIZE - world.topLeft.y,
        })
      }
    }
    return next
  }, [world, size.width, size.height, view.zoom])

  const toScreen = useCallback(
    (point: LatLng) => {
      if (!world) return { x: 0, y: 0 }
      const projected = projectPoint(point, world.scale)
      return { x: projected.x - world.topLeft.x, y: projected.y - world.topLeft.y }
    },
    [world]
  )

  const metersPerPixel = useMemo(() => {
    if (!world) return 1
    return (156543.03392 * Math.cos((view.center.lat * Math.PI) / 180)) / 2 ** view.zoom
  }, [view.center.lat, view.zoom, world])

  const latLngFromClient = useCallback(
    (clientX: number, clientY: number): LatLng | null => {
      if (!world || !containerRef.current) return null
      const rect = containerRef.current.getBoundingClientRect()
      const x = clientX - rect.left + world.topLeft.x
      const y = clientY - rect.top + world.topLeft.y
      return unprojectPoint(x, y, world.scale)
    },
    [world]
  )

  const zoomTo = useCallback(
    (nextZoom: number, focal?: { x: number; y: number }) => {
      setView((current) => {
        const zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.round(nextZoom)))
        if (zoom === current.zoom) return current
        const rect = containerRef.current?.getBoundingClientRect()
        const width = size.width || rect?.width || 0
        const height = size.height || rect?.height || 0
        if (!width || !height) return { ...current, zoom }
        const fx = focal && rect ? focal.x - rect.left : width / 2
        const fy = focal && rect ? focal.y - rect.top : height / 2
        const scale = TILE_SIZE * 2 ** current.zoom
        const centerWorld = projectPoint(current.center, scale)
        const focusWorld = {
          x: centerWorld.x - width / 2 + fx,
          y: centerWorld.y - height / 2 + fy,
        }
        const focusLatLng = unprojectPoint(focusWorld.x, focusWorld.y, scale)
        const nextScale = TILE_SIZE * 2 ** zoom
        const focusNext = projectPoint(focusLatLng, nextScale)
        const nextCenter = unprojectPoint(
          focusNext.x + width / 2 - fx,
          focusNext.y + height / 2 - fy,
          nextScale
        )
        return { center: nextCenter, zoom }
      })
    },
    [size.height, size.width]
  )

  useEffect(() => {
    const element = containerRef.current
    if (!element) return
    const handleWheel = (event: WheelEvent) => {
      if ((event.target as HTMLElement).closest('[data-map-control]')) return
      event.preventDefault()
      const step = event.deltaY > 0 ? -1 : 1
      zoomTo(view.zoom + step, {
        x: event.clientX,
        y: event.clientY,
      })
    }
    element.addEventListener('wheel', handleWheel, { passive: false })
    return () => element.removeEventListener('wheel', handleWheel)
  }, [view.zoom, zoomTo])

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    if ((event.target as HTMLElement).closest('[data-map-control]')) return
    if (!world) return
    panRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      centerWorld: projectPoint(view.center, world.scale),
      scale: world.scale,
      moved: false,
    }
    setIsPanning(true)
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (world) {
      const next = latLngFromClient(event.clientX, event.clientY)
      if (next) setCursor(next)
    }
    const pan = panRef.current
    if (!pan || pan.pointerId !== event.pointerId) return
    const dx = event.clientX - pan.startX
    const dy = event.clientY - pan.startY
    if (!pan.moved && Math.hypot(dx, dy) < 4) return
    pan.moved = true
    const nextCenter = unprojectPoint(
      pan.centerWorld.x - dx,
      pan.centerWorld.y - dy,
      pan.scale
    )
    setView((current) => ({ ...current, center: nextCenter }))
  }

  const endPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    const pan = panRef.current
    if (pan && pan.pointerId === event.pointerId) {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }
      if (!pan.moved && onMapClick) {
        const position = latLngFromClient(event.clientX, event.clientY)
        if (position) onMapClick(position)
      }
    }
    panRef.current = null
    setIsPanning(false)
  }

  const handleSearch = async (event: FormEvent) => {
    event.preventDefault()
    const query = searchQuery.trim()
    if (!query) return
    setSearchState('loading')
    setSearchError('')
    setResults([])
    try {
      const url = `${SEARCH_URL}?format=jsonv2&limit=5&addressdetails=0&accept-language=en&q=${encodeURIComponent(query)}`
      const response = await fetch(url, { headers: { Accept: 'application/json' } })
      if (!response.ok) throw new Error('Address search is unavailable right now.')
      const payload = (await response.json()) as Array<{
        place_id: number
        display_name: string
        lat: string
        lon: string
      }>
      const next = payload.map((item) => ({
        placeId: String(item.place_id),
        label: item.display_name,
        position: { lat: Number(item.lat), lng: Number(item.lon) },
      }))
      setResults(next)
      setSearchState('idle')
      if (next.length === 0) setSearchError('No matching address found. Try a more specific search.')
    } catch (error) {
      setSearchState('error')
      setSearchError(
        error instanceof Error ? error.message : 'Address search is unavailable right now.'
      )
    }
  }

  const selectSearchResult = (result: SearchResult) => {
    setView((current) => ({
      center: result.position,
      zoom: Math.max(current.zoom, 15),
    }))
    setResults([])
    setSearchQuery(result.label.split(',').slice(0, 2).join(','))
    setSearchError('')
    onSearchSelect?.(result.position, result.label)
  }

  const locate = () => {
    if (!navigator.geolocation) {
      setMessage({ tone: 'error', text: 'Location is not available in this browser.' })
      return
    }
    setGeoState('loading')
    setMessage(null)
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const next = { lat: position.coords.latitude, lng: position.coords.longitude }
        setView((current) => ({ center: next, zoom: Math.max(current.zoom, 16) }))
        onLocate?.(next)
        setGeoState('idle')
      },
      () => {
        setGeoState('idle')
        setMessage({
          tone: 'error',
          text: 'Location permission was denied or unavailable. You can still search for an address.',
        })
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 30_000 }
    )
  }

  const mapUnavailable = tileErrors > 2 && tileLoaded === 0

  return (
    <div
      ref={containerRef}
      className={cn(
        'relative select-none overflow-hidden rounded-xl border border-border/80 bg-muted shadow-sm',
        className ?? 'h-[520px]',
        isPanning ? 'cursor-grabbing' : drawing ? 'cursor-crosshair' : 'cursor-grab'
      )}
      role="application"
      aria-label={ariaLabel}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endPan}
      onPointerCancel={endPan}
      onPointerLeave={() => setCursor(null)}
    >
      <div className="pointer-events-none absolute inset-0 map-grid" aria-hidden />

      {tiles.map((tile) => (
        <img
          key={tile.key}
          src={tile.src}
          alt=""
          draggable={false}
          width={TILE_SIZE}
          height={TILE_SIZE}
          className="pointer-events-none absolute max-w-none select-none"
          style={{ left: tile.left, top: tile.top }}
          onLoad={() => setTileLoaded((count) => count + 1)}
          onError={() => setTileErrors((count) => count + 1)}
        />
      ))}

      {mapUnavailable && (
        <div className="absolute inset-0 z-10 flex items-center justify-center p-6">
          <div className="max-w-sm rounded-xl border border-border/80 bg-card/95 p-5 text-center shadow-premium backdrop-blur">
            <AlertCircle className="mx-auto mb-2 h-6 w-6 text-amber-500" />
            <p className="font-headline text-headline-md text-foreground">Basemap unavailable</p>
            <p className="mt-1 text-body-sm text-muted-foreground">
              Map tiles could not be loaded. Coordinates, geofence shapes, and editing still work
              on the coordinate grid.
            </p>
          </div>
        </div>
      )}

      {/* Saved and draft geofences */}
      {world &&
        circles.map((circle) => {
          const screen = toScreen(circle.center)
          const diameter = (circle.radiusMeters / metersPerPixel) * 2
          if (!Number.isFinite(diameter) || diameter <= 0) return null
          return (
            <div
              key={circle.id}
              className={cn(
                'pointer-events-none absolute z-10 rounded-full transition-[width,height] duration-150',
                circle.tone === 'draft'
                  ? 'border-2 border-dashed'
                  : circle.tone === 'muted'
                    ? 'border'
                    : 'border-2',
                circleToneStyles[circle.tone ?? 'saved']
              )}
              style={{
                left: screen.x,
                top: screen.y,
                width: Math.min(diameter, 20_000),
                height: Math.min(diameter, 20_000),
                transform: 'translate(-50%, -50%)',
              }}
              aria-hidden
            >
              {circle.tone === 'draft' && (
                <span className="absolute left-1/2 top-0 -translate-x-1/2 -translate-y-full rounded-full bg-primary px-2 py-0.5 font-label text-[10px] font-semibold uppercase tracking-wider text-primary-foreground shadow-sm">
                  Preview
                </span>
              )}
            </div>
          )
        })}

      {world && polygons.length > 0 && (
        <svg
          className="pointer-events-none absolute inset-0 z-10 h-full w-full"
          aria-hidden
        >
          {polygons.map((polygon) => {
            const points = polygon.points.map((point) => toScreen(point))
            if (points.length < 2) return null
            const polygonPoints = points.map((point) => `${point.x},${point.y}`).join(' ')
            return (
              <g key={polygon.id}>
                <polygon
                  points={polygonPoints}
                  className={
                    polygon.tone === 'saved'
                      ? 'fill-primary/10 stroke-primary/70'
                      : 'fill-primary/10 stroke-primary'
                  }
                  strokeWidth={2}
                  strokeDasharray={polygon.tone === 'saved' ? undefined : '8 6'}
                  vectorEffect="non-scaling-stroke"
                />
              </g>
            )
          })}
        </svg>
      )}

      {/* Polygon vertex handles */}
      {world &&
        polygons.flatMap((polygon) =>
          polygon.points.map((point, index) => {
            if (polygon.tone === 'saved') return null
            const screen = toScreen(point)
            return (
              <button
                key={`${polygon.id}-${index}`}
                type="button"
                data-map-control
                className="absolute z-30 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 cursor-grab rounded-full border-2 border-primary bg-card shadow-sm transition-transform hover:scale-125"
                style={{ left: screen.x, top: screen.y }}
                aria-label={`Move polygon point ${index + 1}`}
                onPointerDown={(event) => {
                  event.stopPropagation()
                  event.currentTarget.setPointerCapture(event.pointerId)
                  vertexDragRef.current = { polygonId: polygon.id, index }
                }}
                onPointerMove={(event) => {
                  const drag = vertexDragRef.current
                  if (!drag || drag.polygonId !== polygon.id || drag.index !== index) return
                  const position = latLngFromClient(event.clientX, event.clientY)
                  if (position) onPolygonVertexDrag?.(polygon.id, index, position)
                }}
                onPointerUp={(event) => {
                  event.stopPropagation()
                  if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                    event.currentTarget.releasePointerCapture(event.pointerId)
                  }
                  vertexDragRef.current = null
                }}
                onClick={(event) => event.stopPropagation()}
              />
            )
          })
        )}

      {/* Markers */}
      {world &&
        markers.map((marker) => {
          const screen = toScreen(marker.position)
          const tone = marker.tone ?? 'primary'
          return (
            <button
              key={marker.id}
              type="button"
              data-map-control
              className="group absolute z-20 -translate-x-1/2 -translate-y-full focus:outline-none"
              style={{ left: screen.x, top: screen.y }}
              title={marker.sublabel ? `${marker.label} — ${marker.sublabel}` : marker.label}
              onPointerDown={(event) => {
                event.stopPropagation()
                if (!marker.draggable) return
                event.currentTarget.setPointerCapture(event.pointerId)
                markerDragRef.current = { id: marker.id, moved: false }
              }}
              onPointerMove={(event) => {
                const drag = markerDragRef.current
                if (!drag || drag.id !== marker.id || !onMarkerDrag) return
                drag.moved = true
                const position = latLngFromClient(event.clientX, event.clientY)
                if (position) onMarkerDrag(marker.id, position)
              }}
              onPointerUp={(event) => {
                event.stopPropagation()
                if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                  event.currentTarget.releasePointerCapture(event.pointerId)
                }
                const drag = markerDragRef.current
                markerDragRef.current = null
                if (drag && !drag.moved) marker.onClick?.()
              }}
              onClick={(event) => {
                event.stopPropagation()
                if (!marker.draggable) marker.onClick?.()
              }}
            >
              <span
                className={cn(
                  'relative flex h-9 w-9 items-center justify-center rounded-full shadow-lg ring-4 transition-transform duration-150 group-hover:scale-110',
                  markerToneStyles[tone],
                  tone === 'selected' && 'scale-110 ring-8'
                )}
              >
                <MapPin className="h-4 w-4" />
                {tone === 'selected' && (
                  <span className="absolute -inset-2 animate-ping rounded-full bg-primary/20" />
                )}
              </span>
              <span
                className={cn(
                  'absolute left-1/2 top-full mt-1 max-w-[170px] -translate-x-1/2 truncate whitespace-nowrap rounded-md border border-border/70 bg-card/95 px-1.5 py-0.5 font-label text-[10px] font-medium text-foreground shadow-sm',
                  'opacity-0 transition-opacity group-hover:opacity-100',
                  tone === 'selected' && 'opacity-100'
                )}
              >
                {marker.label}
              </span>
            </button>
          )
        })}

      {/* Search */}
      {showSearch && (
        <div
          data-map-control
          className="absolute left-3 top-3 z-40 w-[min(360px,calc(100%-5.5rem))]"
          onPointerDown={(event) => event.stopPropagation()}
          onPointerUp={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
          <form onSubmit={handleSearch} className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search an address or place…"
              className="h-10 w-full rounded-lg border border-border/80 bg-card/95 pl-9 pr-20 text-body-sm text-foreground shadow-premium backdrop-blur placeholder:text-muted-foreground/70 focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15"
              aria-label="Search for an address"
            />
            <div className="absolute right-1.5 top-1/2 flex -translate-y-1/2 items-center gap-1">
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery('')
                    setResults([])
                    setSearchError('')
                  }}
                  className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                  aria-label="Clear search"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
              <button
                type="submit"
                disabled={searchState === 'loading' || !searchQuery.trim()}
                className="rounded-md bg-primary px-2.5 py-1.5 font-label text-label-sm text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
              >
                {searchState === 'loading' ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  'Search'
                )}
              </button>
            </div>
          </form>
          {(results.length > 0 || searchError) && (
            <div className="mt-1.5 overflow-hidden rounded-lg border border-border/80 bg-card/98 shadow-premium backdrop-blur">
              {searchError && (
                <p className="px-3 py-2.5 text-body-sm text-amber-700 dark:text-amber-400">
                  {searchError}
                </p>
              )}
              {results.map((result) => (
                <button
                  key={result.placeId}
                  type="button"
                  onClick={() => selectSearchResult(result)}
                  className="flex w-full items-start gap-2 border-b border-border/60 px-3 py-2.5 text-left transition-colors last:border-b-0 hover:bg-muted/70"
                >
                  <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                  <span className="min-w-0">
                    <span className="block truncate font-label text-label-md text-foreground">
                      {result.label.split(',')[0]}
                    </span>
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {result.label}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Map controls */}
      <div
        data-map-control
        className="absolute right-3 top-3 z-40 flex flex-col items-end gap-2"
        onPointerDown={(event) => event.stopPropagation()}
        onPointerUp={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex flex-col overflow-hidden rounded-lg border border-border/80 bg-card/95 shadow-premium backdrop-blur">
          <button
            type="button"
            onClick={() => zoomTo(view.zoom + 1)}
            className="flex h-9 w-9 items-center justify-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label="Zoom in"
          >
            <Plus className="h-4 w-4" />
          </button>
          <div className="h-px bg-border" />
          <button
            type="button"
            onClick={() => zoomTo(view.zoom - 1)}
            className="flex h-9 w-9 items-center justify-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label="Zoom out"
          >
            <Minus className="h-4 w-4" />
          </button>
        </div>
        <button
          type="button"
          onClick={locate}
          disabled={geoState === 'loading'}
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-border/80 bg-card/95 text-muted-foreground shadow-premium backdrop-blur transition-colors hover:bg-muted hover:text-foreground disabled:opacity-60"
          aria-label="Use my current location"
          title="Use my current location"
        >
          {geoState === 'loading' ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Crosshair className="h-4 w-4" />
          )}
        </button>
        <button
          type="button"
          onClick={() => {
            setView({ center: initialView.current.center, zoom: initialView.current.zoom })
          }}
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-border/80 bg-card/95 text-muted-foreground shadow-premium backdrop-blur transition-colors hover:bg-muted hover:text-foreground"
          aria-label="Reset map view"
          title="Reset map view"
        >
          <RotateCcw className="h-4 w-4" />
        </button>
      </div>

      {/* Drawing hint */}
      {drawing && (
        <div className="pointer-events-none absolute left-1/2 top-3 z-30 -translate-x-1/2 rounded-full border border-primary/25 bg-primary/95 px-3 py-1.5 font-label text-label-sm text-primary-foreground shadow-lg">
          Click the map to add polygon points · drag points to adjust
        </div>
      )}

      {/* Message */}
      {message && (
        <div className="absolute bottom-16 left-3 right-3 z-40 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-card/95 p-3 text-body-sm text-foreground shadow-premium backdrop-blur sm:left-1/2 sm:right-auto sm:w-[420px] sm:-translate-x-1/2">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
          <span className="min-w-0 flex-1">{message.text}</span>
          <button
            type="button"
            onClick={() => setMessage(null)}
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Dismiss message"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Footer: coordinates + attribution */}
      <div
        data-map-control
        className="pointer-events-none absolute bottom-2 left-3 z-30 flex flex-col gap-1"
        onPointerDown={(event) => event.stopPropagation()}
        onPointerUp={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
      >
        <span className="inline-flex w-fit items-center gap-1.5 rounded-md bg-card/90 px-2 py-1 font-mono text-[10px] tabular-nums text-muted-foreground shadow-sm backdrop-blur">
          {cursor
            ? `${formatCoordinate(cursor.lat, 5)}, ${formatCoordinate(cursor.lng, 5)}`
            : `${formatCoordinate(view.center.lat, 5)}, ${formatCoordinate(view.center.lng, 5)}`}
          <span className="text-border">|</span>
          z{view.zoom}
        </span>
        <span className="w-fit rounded bg-card/75 px-1.5 py-0.5 text-[9px] text-muted-foreground/80 backdrop-blur">
          © OpenStreetMap contributors
        </span>
      </div>

      {/* Clear / save actions */}
      {showSave && (
        <div
          data-map-control
          className="absolute bottom-3 right-3 z-40 flex items-center gap-2"
          onPointerDown={(event) => event.stopPropagation()}
          onPointerUp={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
          {onClear && (
            <button
              type="button"
              onClick={onClear}
              className="flex h-9 items-center gap-1.5 rounded-lg border border-border/80 bg-card/95 px-3 font-label text-label-md text-muted-foreground shadow-premium backdrop-blur transition-colors hover:bg-muted hover:text-foreground"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Clear
            </button>
          )}
          {onSave && (
            <button
              type="button"
              onClick={onSave}
              disabled={saveDisabled || saving}
              className="flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3.5 font-label text-label-md text-primary-foreground shadow-lg shadow-primary/25 transition-colors hover:bg-primary/90 disabled:opacity-50"
            >
              {saving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Check className="h-3.5 w-3.5" />
              )}
              {saveLabel}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
