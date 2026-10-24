import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  createSite,
  deleteSite,
  fetchEmployeeSites,
  fetchEmployees,
  fetchSites,
  unassignEmployeeFromSite,
  updateSite,
} from '@/api/services'
import type { Site, SiteInsert, SiteUpdate } from '@/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { PageHeader } from '@/components/ui/page-header'
import { PageSkeleton, EmptyState, ErrorState } from '@/components/ui/states'
import { useToast } from '@/components/ui/toast'
import {
  MapCanvas,
  type MapCircle,
  type MapMarker,
  type MapPolygon,
} from '@/components/map/MapCanvas'
import {
  circleArea,
  centroidOf,
  formatArea,
  formatCoordinate,
  formatRadius,
  maxDistanceFrom,
  type LatLng,
} from '@/lib/geo'
import {
  ArrowRight,
  Crosshair,
  Layers,
  Loader2,
  MapPinned,
  MousePointerClick,
  Pencil,
  Plus,
  Search,
  Settings2,
  Trash2,
  Users,
  X,
} from 'lucide-react'
import { cn } from '@/lib/utils'

const DEFAULT_CENTER: LatLng = { lat: 20.5937, lng: 78.9629 }
const DEFAULT_RADIUS = 500

type Selection = string | 'new' | null

function sitePosition(site: Site): LatLng {
  return { lat: site.latitude, lng: site.longitude }
}

export function SitesPage() {
  const queryClient = useQueryClient()
  const { toast } = useToast()

  const sitesQuery = useQuery({ queryKey: ['sites'], queryFn: fetchSites })
  const { data: employees = [] } = useQuery({
    queryKey: ['employees'],
    queryFn: fetchEmployees,
  })
  const { data: assignments = [] } = useQuery({
    queryKey: ['employee-sites'],
    queryFn: () => fetchEmployeeSites(),
  })

  const sites = sitesQuery.data ?? []

  const [selectedId, setSelectedId] = useState<Selection>(null)
  const [mapCenter, setMapCenter] = useState<LatLng>(DEFAULT_CENTER)
  const [filter, setFilter] = useState('')
  const [name, setName] = useState('')
  const [latitude, setLatitude] = useState('')
  const [longitude, setLongitude] = useState('')
  const [radius, setRadius] = useState(String(DEFAULT_RADIUS))
  const [boundaryPoints, setBoundaryPoints] = useState<LatLng[]>([])
  const [drawingBoundary, setDrawingBoundary] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Site | null>(null)
  const [unassigning, setUnassigning] = useState<string | null>(null)

  const centeredRef = useRef(false)

  useEffect(() => {
    if (centeredRef.current || sites.length === 0) return
    centeredRef.current = true
    const center = centroidOf(sites.map(sitePosition))
    if (center) setMapCenter(center)
  }, [sites])

  const selectedSite = useMemo(
    () => (selectedId && selectedId !== 'new' ? sites.find((site) => site.id === selectedId) ?? null : null),
    [selectedId, sites]
  )

  const filteredSites = useMemo(() => {
    const query = filter.trim().toLowerCase()
    if (!query) return sites
    return sites.filter((site) => site.name.toLowerCase().includes(query))
  }, [filter, sites])

  const staffBySite = useMemo(() => {
    const counts = new Map<string, number>()
    assignments.forEach((assignment) => {
      counts.set(assignment.site_id, (counts.get(assignment.site_id) ?? 0) + 1)
    })
    return counts
  }, [assignments])

  const assignedStaff = useMemo(() => {
    if (!selectedSite) return []
    const employeeById = new Map(employees.map((employee) => [employee.id, employee]))
    return assignments
      .filter((assignment) => assignment.site_id === selectedSite.id)
      .map((assignment) => ({
        assignment,
        employee: employeeById.get(assignment.employee_id),
      }))
  }, [assignments, employees, selectedSite])

  const draftLat = Number(latitude)
  const draftLng = Number(longitude)
  const draftRadius = Number(radius)
  const positionValid =
    latitude.trim() !== '' &&
    longitude.trim() !== '' &&
    Number.isFinite(draftLat) &&
    Number.isFinite(draftLng) &&
    draftLat >= -90 &&
    draftLat <= 90 &&
    draftLng >= -180 &&
    draftLng <= 180
  const radiusValid = Number.isFinite(draftRadius) && draftRadius >= 10 && draftRadius <= 50_000
  const canSave = name.trim().length > 0 && positionValid && radiusValid

  const editing = selectedId !== null

  const mutation = useMutation({
    mutationFn: async () => {
      if (!canSave) throw new Error('Complete the site name, coordinates, and radius before saving.')
      const payload: SiteInsert = {
        name: name.trim(),
        latitude: draftLat,
        longitude: draftLng,
        radius_in_meters: Math.round(draftRadius),
      }
      if (selectedSite) {
        await updateSite(selectedSite.id, payload as SiteUpdate)
      } else {
        await createSite(payload)
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['sites'] })
      await queryClient.invalidateQueries({ queryKey: ['employee-sites'] })
      toast({
        title: selectedSite ? 'Geofence updated' : 'Site created',
        description: `${name.trim()} is now available for assignment.`,
      })
      closePanel()
    },
    onError: (err) => {
      const text = err instanceof Error ? err.message : 'Failed to save the site.'
      setError(text)
      toast({ title: 'Could not save site', description: text, variant: 'error' })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteSite(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['sites'] })
      await queryClient.invalidateQueries({ queryKey: ['employee-sites'] })
      toast({ title: 'Site deleted', description: 'Assignments for this site were removed.' })
      if (deleteTarget?.id === selectedId) closePanel()
      setDeleteTarget(null)
    },
    onError: (err) => {
      const text = err instanceof Error ? err.message : 'Failed to delete the site.'
      toast({ title: 'Could not delete site', description: text, variant: 'error' })
      setDeleteTarget(null)
    },
  })

  function openEdit(site: Site) {
    setSelectedId(site.id)
    setName(site.name)
    setLatitude(formatCoordinate(site.latitude, 6))
    setLongitude(formatCoordinate(site.longitude, 6))
    setRadius(String(site.radius_in_meters))
    setBoundaryPoints([])
    setDrawingBoundary(false)
    setError(null)
    setMapCenter(sitePosition(site))
  }

  function openCreate(seed?: LatLng) {
    setSelectedId('new')
    setName('')
    setLatitude(seed ? formatCoordinate(seed.lat, 6) : '')
    setLongitude(seed ? formatCoordinate(seed.lng, 6) : '')
    setRadius(String(DEFAULT_RADIUS))
    setBoundaryPoints([])
    setDrawingBoundary(false)
    setError(null)
    if (seed) setMapCenter(seed)
  }

  function closePanel() {
    setSelectedId(null)
    setError(null)
    setBoundaryPoints([])
    setDrawingBoundary(false)
  }

  function handleMapClick(position: LatLng) {
    if (!editing) return
    if (drawingBoundary) {
      setBoundaryPoints((points) => [...points, position])
      return
    }
    setLatitude(formatCoordinate(position.lat, 6))
    setLongitude(formatCoordinate(position.lng, 6))
  }

  function handleMarkerDrag(_id: string, position: LatLng) {
    setLatitude(formatCoordinate(position.lat, 6))
    setLongitude(formatCoordinate(position.lng, 6))
    setBoundaryPoints([])
  }

  function handlePolygonVertexDrag(_polygonId: string, index: number, position: LatLng) {
    setBoundaryPoints((points) => points.map((point, i) => (i === index ? position : point)))
  }

  function applyBoundaryAsCircle() {
    if (boundaryPoints.length < 3) return
    const centroid = centroidOf(boundaryPoints)
    if (!centroid) return
    const radiusMeters = Math.max(25, Math.ceil(maxDistanceFrom(centroid, boundaryPoints)))
    setLatitude(formatCoordinate(centroid.lat, 6))
    setLongitude(formatCoordinate(centroid.lng, 6))
    setRadius(String(radiusMeters))
    setMapCenter(centroid)
    setDrawingBoundary(false)
    toast({
      title: 'Boundary converted to a geofence',
      description: `Saved as a ${formatRadius(radiusMeters)} circle around the boundary center.`,
      variant: 'info',
    })
  }

  function resetDraftToSaved() {
    if (!selectedSite) {
      openCreate()
      return
    }
    openEdit(selectedSite)
  }

  async function handleUnassign(employeeId: string, siteId: string) {
    setUnassigning(employeeId)
    try {
      await unassignEmployeeFromSite(employeeId, siteId)
      await queryClient.invalidateQueries({ queryKey: ['employee-sites'] })
      toast({ title: 'Employee unassigned' })
    } catch (err) {
      const text = err instanceof Error ? err.message : 'Failed to unassign employee.'
      toast({ title: 'Could not unassign employee', description: text, variant: 'error' })
    } finally {
      setUnassigning(null)
    }
  }

  if (sitesQuery.isLoading) return <PageSkeleton cards={0} rows={6} />

  if (sitesQuery.isError) {
    return (
      <div className="page-shell">
        <PageHeader
          title="Sites & Geofences"
          description="Manage work locations, boundaries, and on-site staffing."
          icon={MapPinned}
        />
        <ErrorState
          title="Sites could not be loaded"
          description={sitesQuery.error instanceof Error ? sitesQuery.error.message : undefined}
          onRetry={() => sitesQuery.refetch()}
        />
      </div>
    )
  }

  const draftCircle: MapCircle[] =
    positionValid && radiusValid
      ? [
          {
            id: 'draft-geofence',
            center: { lat: draftLat, lng: draftLng },
            radiusMeters: draftRadius,
            tone: 'draft',
          },
        ]
      : []

  const markers: MapMarker[] = [
    ...sites
      .filter((site) => site.id !== selectedId)
      .map<MapMarker>((site) => ({
        id: site.id,
        position: sitePosition(site),
        label: site.name,
        sublabel: formatRadius(site.radius_in_meters),
        tone: 'muted',
        onClick: () => openEdit(site),
      })),
    ...(editing && positionValid
      ? [
          {
            id: 'draft-marker',
            position: { lat: draftLat, lng: draftLng },
            label: selectedSite ? 'Unsaved changes' : 'New site',
            sublabel: 'Drag to reposition',
            tone: 'selected',
            draggable: true,
          } satisfies MapMarker,
        ]
      : []),
  ]

  const circles: MapCircle[] = [
    ...sites
      .filter((site) => site.id !== selectedId)
      .map<MapCircle>((site) => ({
        id: site.id,
        center: sitePosition(site),
        radiusMeters: site.radius_in_meters,
        tone: 'muted',
      })),
    ...draftCircle,
  ]

  const polygons: MapPolygon[] =
    boundaryPoints.length > 0
      ? [{ id: 'draft-boundary', points: boundaryPoints, tone: 'draft' }]
      : []

  return (
    <div className="page-shell">
      <PageHeader
        eyebrow="Workspace"
        title="Sites & Geofences"
        description="Place work sites on the map, tune their geofence radius, and review on-site staffing."
        icon={MapPinned}
        actions={
          <>
            <Badge variant="outline" className="hidden sm:inline-flex">
              {sites.length} {sites.length === 1 ? 'site' : 'sites'}
            </Badge>
            <Button onClick={() => openCreate()} className="gap-2">
              <Plus className="h-4 w-4" />
              Add site
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[290px_minmax(0,1fr)_360px]">
        {/* Site list */}
        <section className="surface-panel flex max-h-[640px] flex-col overflow-hidden">
          <div className="flex items-center justify-between border-b border-border/70 px-4 py-3.5">
            <div>
              <h2 className="font-headline text-headline-sm text-foreground">Work sites</h2>
              <p className="text-[11px] text-muted-foreground">Select a site to edit its fence.</p>
            </div>
            <button
              onClick={() => openCreate()}
              className="rounded-lg border border-border/70 p-1.5 text-muted-foreground transition-colors hover:border-primary/30 hover:bg-primary/10 hover:text-primary"
              aria-label="Add a site"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
          <div className="border-b border-border/70 bg-muted/40 p-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                placeholder="Filter sites…"
                className="h-8 pl-8 text-body-sm"
                aria-label="Filter sites by name"
              />
              {filter && (
                <button
                  onClick={() => setFilter('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  aria-label="Clear filter"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
          <div className="scrollbar-thin flex-1 overflow-y-auto p-2">
            {filteredSites.length === 0 ? (
              <div className="px-3 py-10 text-center">
                <MapPinned className="mx-auto mb-2 h-7 w-7 text-muted-foreground/50" />
                <p className="font-label text-label-md text-foreground">No sites found</p>
                <p className="mt-1 text-body-sm text-muted-foreground">
                  {filter ? 'Try a different filter.' : 'Add your first work site to get started.'}
                </p>
                {!filter && (
                  <Button size="sm" onClick={() => openCreate()} className="mt-3 gap-1.5">
                    <Plus className="h-3.5 w-3.5" /> Add site
                  </Button>
                )}
              </div>
            ) : (
              <ul className="flex flex-col gap-1">
                {filteredSites.map((site) => {
                  const active = site.id === selectedId
                  const staff = staffBySite.get(site.id) ?? 0
                  return (
                    <li key={site.id}>
                      <div
                        className={cn(
                          'group relative rounded-lg border p-2.5 transition-colors',
                          active
                            ? 'border-primary/35 bg-primary/[0.06] shadow-sm'
                            : 'border-transparent hover:border-border hover:bg-muted/50'
                        )}
                      >
                        {active && (
                          <span className="absolute left-0 top-1/2 h-8 w-[3px] -translate-y-1/2 rounded-r-full bg-primary" />
                        )}
                        <button
                          onClick={() => openEdit(site)}
                          className="w-full text-left"
                          aria-label={`Edit ${site.name}`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <span className="truncate font-label text-label-md font-semibold text-foreground">
                              {site.name}
                            </span>
                            <Badge variant="success" dot className="shrink-0">
                              Live
                            </Badge>
                          </div>
                          <p className="mt-1 truncate font-mono text-[10px] text-muted-foreground">
                            {formatCoordinate(site.latitude, 4)}, {formatCoordinate(site.longitude, 4)}
                          </p>
                          <div className="mt-2 flex items-center gap-3 text-[11px] text-muted-foreground">
                            <span className="inline-flex items-center gap-1">
                              <Crosshair className="h-3 w-3" /> {formatRadius(site.radius_in_meters)}
                            </span>
                            <span className="inline-flex items-center gap-1">
                              <Users className="h-3 w-3" /> {staff}
                            </span>
                            <span className="ml-auto inline-flex items-center gap-1 text-primary opacity-0 transition-opacity group-hover:opacity-100">
                              Edit <ArrowRight className="h-3 w-3" />
                            </span>
                          </div>
                        </button>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
          <div className="border-t border-border/70 p-3">
            <p className="flex items-start gap-2 text-[11px] leading-relaxed text-muted-foreground">
              <Layers className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
              Saved geofences are circles (center + radius). Polygon drawing is a visual planning aid
              that converts to a circle.
            </p>
          </div>
        </section>

        {/* Map */}
        <section className="min-w-0">
          <MapCanvas
            center={mapCenter}
            zoom={13}
            markers={markers}
            circles={circles}
            polygons={polygons}
            drawing={drawingBoundary}
            onMapClick={handleMapClick}
            onMarkerDrag={handleMarkerDrag}
            onPolygonVertexDrag={handlePolygonVertexDrag}
            onSearchSelect={(position) => {
              if (!editing) {
                openCreate(position)
                return
              }
              setLatitude(formatCoordinate(position.lat, 6))
              setLongitude(formatCoordinate(position.lng, 6))
              setMapCenter(position)
            }}
            className="h-[420px] sm:h-[520px] xl:h-[640px]"
            ariaLabel="Sites and geofences map"
          />
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 px-1 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full border-2 border-primary bg-primary/20" />
              Geofence
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full border-2 border-dashed border-primary" />
              Unsaved preview
            </span>
            <span className="inline-flex items-center gap-1.5">
              <MousePointerClick className="h-3.5 w-3.5 text-primary" />
              {editing
                ? drawingBoundary
                  ? 'Click to add boundary points'
                  : 'Click the map or drag the pin to move the site'
                : 'Select a site or add a new one to edit it'}
            </span>
          </div>
        </section>

        {/* Editor */}
        <aside className="surface-panel flex max-h-[640px] flex-col overflow-hidden">
          {!editing ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-inset ring-primary/15">
                <Settings2 className="h-5 w-5" />
              </span>
              <div>
                <h2 className="font-headline text-headline-md text-foreground">Site editor</h2>
                <p className="mt-1 text-body-sm text-muted-foreground">
                  Choose a site from the list or drop a new pin on the map to configure its
                  geofence.
                </p>
              </div>
              <Button variant="outline" onClick={() => openCreate()} className="mt-1 gap-2">
                <Plus className="h-4 w-4" />
                New site
              </Button>
              {sites.length === 0 && (
                <EmptyState
                  icon={MapPinned}
                  title="No work sites yet"
                  description="Add a site to start tracking attendance with geofences."
                  className="mt-2 w-full border-0 bg-transparent px-0 py-4"
                />
              )}
            </div>
          ) : (
            <>
              <div className="flex items-start justify-between gap-3 border-b border-border/70 px-4 py-3.5">
                <div className="min-w-0">
                  <p className="font-label text-[10px] uppercase tracking-[0.16em] text-primary">
                    {selectedSite ? 'Editing geofence' : 'New geofence'}
                  </p>
                  <h2 className="truncate font-headline text-headline-sm text-foreground">
                    {selectedSite?.name ?? 'Untitled site'}
                  </h2>
                </div>
                <button
                  onClick={closePanel}
                  className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  aria-label="Close site editor"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="scrollbar-thin flex-1 space-y-5 overflow-y-auto px-4 py-4">
                {error && (
                  <div
                    role="alert"
                    className="rounded-lg border border-red-500/25 bg-red-500/[0.06] p-3 text-body-sm text-red-700 dark:text-red-300"
                  >
                    {error}
                  </div>
                )}

                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="site-name" className="text-label-md">
                      Site name <span className="text-primary">*</span>
                    </Label>
                    <Input
                      id="site-name"
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      placeholder="e.g. North Hub Logistics"
                      autoComplete="off"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="site-lat" className="text-label-md">
                        Latitude <span className="text-primary">*</span>
                      </Label>
                      <Input
                        id="site-lat"
                        type="number"
                        step="0.000001"
                        value={latitude}
                        onChange={(event) => {
                          setLatitude(event.target.value)
                          setBoundaryPoints([])
                        }}
                        placeholder="20.593700"
                        className="font-mono text-body-sm"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="site-lng" className="text-label-md">
                        Longitude <span className="text-primary">*</span>
                      </Label>
                      <Input
                        id="site-lng"
                        type="number"
                        step="0.000001"
                        value={longitude}
                        onChange={(event) => {
                          setLongitude(event.target.value)
                          setBoundaryPoints([])
                        }}
                        placeholder="78.962900"
                        className="font-mono text-body-sm"
                      />
                    </div>
                  </div>
                  {!positionValid && (latitude || longitude) && (
                    <p className="text-[11px] text-amber-600 dark:text-amber-400">
                      Enter a valid latitude (−90 to 90) and longitude (−180 to 180).
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      if (positionValid) setMapCenter({ lat: draftLat, lng: draftLng })
                    }}
                    disabled={!positionValid}
                    className="inline-flex items-center gap-1.5 text-[11px] font-medium text-primary hover:underline disabled:opacity-50"
                  >
                    <Crosshair className="h-3 w-3" /> Center map on these coordinates
                  </button>
                </div>

                <div className="space-y-3 border-t border-border/60 pt-4">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="site-radius" className="text-label-md">
                      Geofence radius
                    </Label>
                    <span className="font-mono text-body-sm font-semibold text-foreground">
                      {radiusValid ? formatRadius(draftRadius) : '—'}
                    </span>
                  </div>
                  <input
                    id="site-radius"
                    type="range"
                    min={25}
                    max={5000}
                    step={25}
                    value={radiusValid ? Math.min(5000, Math.max(25, draftRadius)) : DEFAULT_RADIUS}
                    onChange={(event) => setRadius(event.target.value)}
                    className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-muted accent-primary"
                  />
                  <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                    <span>25 m</span>
                    <span>5 km</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      min={10}
                      max={50000}
                      step={10}
                      value={radius}
                      onChange={(event) => setRadius(event.target.value)}
                      className="h-8 max-w-28 font-mono text-body-sm"
                      aria-label="Exact radius in meters"
                    />
                    <span className="text-body-sm text-muted-foreground">meters</span>
                    <Badge variant="secondary" className="ml-auto">
                      {radiusValid ? formatArea(circleArea(draftRadius)) : '—'}
                    </Badge>
                  </div>
                  {!radiusValid && radius !== '' && (
                    <p className="text-[11px] text-amber-600 dark:text-amber-400">
                      Radius must be between 10 m and 50 km.
                    </p>
                  )}
                </div>

                <div className="space-y-2 rounded-lg border border-border/70 bg-muted/30 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="font-label text-label-md font-semibold text-foreground">
                        Boundary planner
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        Draw a polygon, then convert it to a circle.
                      </p>
                    </div>
                    <Badge variant={boundaryPoints.length >= 3 ? 'success' : 'secondary'}>
                      {boundaryPoints.length} pts
                    </Badge>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant={drawingBoundary ? 'default' : 'outline'}
                      onClick={() => {
                        setDrawingBoundary((current) => !current)
                        if (!drawingBoundary && boundaryPoints.length === 0) {
                          toast({
                            title: 'Boundary drawing enabled',
                            description: 'Click the map to add points. Drag vertices to adjust.',
                            variant: 'info',
                          })
                        }
                      }}
                      className="gap-1.5"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      {drawingBoundary ? 'Drawing…' : 'Draw boundary'}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={applyBoundaryAsCircle}
                      disabled={boundaryPoints.length < 3}
                      className="gap-1.5"
                    >
                      <CheckIcon /> Use shape
                    </Button>
                    {boundaryPoints.length > 0 && (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setBoundaryPoints([])
                          setDrawingBoundary(false)
                        }}
                        className="gap-1.5 text-muted-foreground"
                      >
                        <Trash2 className="h-3.5 w-3.5" /> Clear
                      </Button>
                    )}
                  </div>
                  {boundaryPoints.length > 0 && (
                    <p className="text-[11px] leading-relaxed text-muted-foreground">
                      The polygon stays as a preview. Saving stores the computed center and the
                      smallest enclosing radius. Click on the map to add more points.
                    </p>
                  )}
                </div>

                {selectedSite && (
                  <div className="space-y-2 border-t border-border/60 pt-4">
                    <div className="flex items-center justify-between">
                      <h3 className="flex items-center gap-1.5 font-label text-label-md font-semibold text-foreground">
                        <Users className="h-3.5 w-3.5" /> Assigned staff
                      </h3>
                      <span className="text-[11px] text-muted-foreground">
                        {assignedStaff.length} assigned
                      </span>
                    </div>
                    <div className="overflow-hidden rounded-lg border border-border/70">
                      {assignedStaff.length === 0 ? (
                        <p className="px-3 py-4 text-center text-body-sm text-muted-foreground">
                          No staff assigned to this site.
                        </p>
                      ) : (
                        <ul className="divide-y divide-border/60">
                          {assignedStaff.map(({ assignment, employee }) => (
                            <li
                              key={`${assignment.employee_id}-${assignment.site_id}`}
                              className="flex items-center gap-2 px-3 py-2"
                            >
                              <div className="min-w-0 flex-1">
                                <p className="truncate font-label text-label-md text-foreground">
                                  {employee
                                    ? `${employee.first_name} ${employee.last_name}`
                                    : 'Unknown employee'}
                                </p>
                                <p className="truncate text-[11px] text-muted-foreground">
                                  {employee?.designations?.name ?? 'No designation'}
                                </p>
                              </div>
                              <button
                                onClick={() =>
                                  handleUnassign(assignment.employee_id, assignment.site_id)
                                }
                                disabled={unassigning === assignment.employee_id}
                                className="rounded-md px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                              >
                                {unassigning === assignment.employee_id ? (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                ) : (
                                  'Unassign'
                                )}
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between gap-2 border-t border-border/70 px-4 py-3">
                {selectedSite ? (
                  <button
                    onClick={() => setDeleteTarget(selectedSite)}
                    className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[11px] font-medium text-destructive transition-colors hover:bg-destructive/10"
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Delete
                  </button>
                ) : (
                  <span />
                )}
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={selectedSite ? resetDraftToSaved : closePanel}
                    disabled={mutation.isPending}
                  >
                    {selectedSite ? 'Reset' : 'Cancel'}
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => mutation.mutate()}
                    disabled={!canSave || mutation.isPending}
                    className="gap-1.5"
                  >
                    {mutation.isPending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <MapPinned className="h-3.5 w-3.5" />
                    )}
                    {selectedSite ? 'Save changes' : 'Create site'}
                  </Button>
                </div>
              </div>
            </>
          )}
        </aside>
      </div>

      <Dialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete this site?</DialogTitle>
            <DialogDescription>
              {deleteTarget?.name} will be removed, along with its employee assignments. Historical
              location and attendance records are not affected.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={deleteMutation.isPending}
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
              className="gap-2"
            >
              {deleteMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Delete site
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" aria-hidden>
      <path
        d="M3.5 8.5 6.5 11.5 12.5 4.5"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
