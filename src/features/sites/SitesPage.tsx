import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  fetchSites,
  fetchEmployees,
  fetchEmployeeSites,
  createSite,
  updateSite,
  deleteSite,
  unassignEmployeeFromSite,
} from '@/api/services'
import { Site, SiteInsert, SiteUpdate } from '@/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  Plus,
  Trash2,
  Search,
  MapPin,
  Settings2,
  Users,
  Loader2,
} from 'lucide-react'

export function SitesPage() {
  const queryClient = useQueryClient()
  const { data: sites = [], isLoading } = useQuery({
    queryKey: ['sites'],
    queryFn: fetchSites,
  })
  const { data: employees = [] } = useQuery({
    queryKey: ['employees'],
    queryFn: fetchEmployees,
  })
  const { data: assignments = [] } = useQuery({
    queryKey: ['employee-sites'],
    queryFn: () => fetchEmployeeSites(),
  })

  // null => closed panel; 'new' => create; Site id => edit
  const [selectedId, setSelectedId] = useState<string | 'new' | null>(null)
  const [filter, setFilter] = useState('')
  const [name, setName] = useState('')
  const [latitude, setLatitude] = useState('')
  const [longitude, setLongitude] = useState('')
  const [radiusInMeters, setRadiusInMeters] = useState('500')
  const [error, setError] = useState<string | null>(null)

  const selectedSite = useMemo(
    () => (selectedId && selectedId !== 'new' ? sites.find((s) => s.id === selectedId) ?? null : null),
    [sites, selectedId]
  )

  const filteredSites = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return sites
    return sites.filter((s) => s.name.toLowerCase().includes(q))
  }, [sites, filter])

  const assignedStaff = useMemo(() => {
    if (!selectedSite) return []
    const employeeById = new Map(employees.map((e) => [e.id, e]))
    return assignments
      .filter((a) => a.site_id === selectedSite.id)
      .map((a) => ({ assignment: a, employee: employeeById.get(a.employee_id) }))
  }, [assignments, employees, selectedSite])

  const mutation = useMutation({
    mutationFn: async () => {
      const payload: SiteInsert = {
        name,
        latitude: parseFloat(latitude),
        longitude: parseFloat(longitude),
        radius_in_meters: parseFloat(radiusInMeters),
      }
      if (selectedSite) {
        await updateSite(selectedSite.id, payload as SiteUpdate)
      } else {
        await createSite(payload)
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sites'] })
      setError(null)
      closePanel()
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : 'Failed to save site')
    },
  })

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this site? This will remove it from all employee assignments.')) return
    try {
      await deleteSite(id)
      setError(null)
      if (selectedId === id) setSelectedId(null)
      queryClient.invalidateQueries({ queryKey: ['sites'] })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete site')
    }
  }

  const handleUnassign = async (employeeId: string, siteId: string) => {
    try {
      await unassignEmployeeFromSite(employeeId, siteId)
      setError(null)
      queryClient.invalidateQueries({ queryKey: ['employee-sites'] })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to unassign employee')
    }
  }

  function openEdit(s: Site) {
    setSelectedId(s.id)
    setName(s.name)
    setLatitude(s.latitude.toString())
    setLongitude(s.longitude.toString())
    setRadiusInMeters(s.radius_in_meters.toString())
    setError(null)
  }

  function openCreate() {
    setSelectedId('new')
    setName('')
    setLatitude('')
    setLongitude('')
    setRadiusInMeters('500')
    setError(null)
  }

  function closePanel() {
    setSelectedId(null)
    setError(null)
  }

  if (isLoading) {
    return (
      <div className="flex justify-center py-16">
        <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-primary" />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="font-headline text-headline-lg text-foreground">Sites & Geofences</h1>
          <p className="mt-1 text-body-sm text-muted-foreground">
            Manage work locations and geofence parameters.
          </p>
        </div>
        <Button onClick={openCreate} className="shrink-0 gap-2">
          <Plus className="h-4 w-4" />
          Add Site
        </Button>
      </div>

      {error && !selectedId && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="flex flex-col gap-6 lg:flex-row">
        {/* Sites list */}
        <section className="flex w-full shrink-0 flex-col overflow-hidden rounded-xl border border-border bg-card shadow-sm lg:w-80 lg:self-start">
          <div className="flex items-center justify-between border-b border-border p-4">
            <h2 className="font-headline text-headline-md text-foreground">Active Sites</h2>
            <button
              onClick={openCreate}
              className="flex items-center justify-center rounded-md bg-primary p-1.5 text-primary-foreground shadow-sm transition-colors hover:bg-blue-700"
              title="Add site"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
          <div className="border-b border-border bg-muted/60 p-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filter sites…"
                className="pl-9"
              />
            </div>
          </div>
          <div className="max-h-[480px] space-y-2 overflow-y-auto p-2 lg:max-h-[560px]">
            {filteredSites.length === 0 && (
              <p className="py-10 text-center text-body-sm text-muted-foreground">
                No sites found.
              </p>
            )}
            {filteredSites.map((site) => {
              const active = selectedId === site.id
              const staffCount = assignments.filter((a) => a.site_id === site.id).length
              return (
                <button
                  key={site.id}
                  onClick={() => openEdit(site)}
                  className={`relative w-full rounded-lg border p-3 text-left transition-colors ${
                    active
                      ? 'border-primary/40 bg-primary/5'
                      : 'border-border bg-card hover:border-ring hover:shadow-sm'
                  }`}
                >
                  {active && (
                    <span className="absolute left-0 top-0 h-full w-1 rounded-l-lg bg-primary" />
                  )}
                  <div className="mb-2 flex items-start justify-between gap-2">
                    <h3 className="truncate font-label text-label-md font-bold text-foreground">
                      {site.name}
                    </h3>
                    <Badge variant="success" dot>Live</Badge>
                  </div>
                  <p className="mb-2 truncate font-label text-label-sm text-muted-foreground">
                    {site.latitude.toFixed(4)}, {site.longitude.toFixed(4)}
                  </p>
                  <div className="flex gap-4">
                    <div className="flex flex-col">
                      <span className="font-label text-label-sm text-muted-foreground">Radius</span>
                      <span className="text-body-md font-semibold text-foreground">{site.radius_in_meters}m</span>
                    </div>
                    <div className="flex flex-col">
                      <span className="font-label text-label-sm text-muted-foreground">Staff</span>
                      <span className="text-body-md font-semibold text-primary">{staffCount}</span>
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        </section>

        {/* Configuration drawer */}
        {selectedId === null ? (
          <section className="flex flex-1 flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card/50 p-12 text-center">
            <Settings2 className="mb-3 h-10 w-10 text-muted-foreground/50" />
            <h2 className="font-headline text-headline-md text-foreground">Site Configuration</h2>
            <p className="mt-1 max-w-sm text-body-sm text-muted-foreground">
              Select a site from the list to edit its details and geofence boundary, or add a new site.
            </p>
          </section>
        ) : (
          <aside className="flex min-h-[420px] flex-1 flex-col overflow-hidden rounded-xl border border-border bg-card shadow-sm">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card p-4">
              <div className="flex items-center gap-2">
                <Settings2 className="h-5 w-5 text-secondary-foreground" />
                <h2 className="font-headline text-headline-md text-foreground">
                  {selectedSite ? 'Site Configuration' : 'New Site'}
                </h2>
              </div>
              {selectedSite && (
                <Badge variant="info">{selectedSite.name}</Badge>
              )}
            </div>

            <div className="flex-1 space-y-6 overflow-y-auto p-6">
              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              {/* Basic info */}
              <div className="space-y-4">
                <h3 className="font-label text-label-md uppercase tracking-wider text-muted-foreground">
                  Basic Information
                </h3>
                <div className="space-y-1.5">
                  <Label htmlFor="site-name" className="font-label text-label-md">Site Name *</Label>
                  <Input
                    id="site-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. North Hub Logistics"
                  />
                </div>
                <div className="flex gap-4">
                  <div className="flex-1 space-y-1.5">
                    <Label htmlFor="site-lat" className="font-label text-label-md">Latitude *</Label>
                    <Input
                      id="site-lat"
                      type="number"
                      step="0.00001"
                      value={latitude}
                      onChange={(e) => setLatitude(e.target.value)}
                      placeholder="34.05223"
                    />
                  </div>
                  <div className="flex-1 space-y-1.5">
                    <Label htmlFor="site-lng" className="font-label text-label-md">Longitude *</Label>
                    <Input
                      id="site-lng"
                      type="number"
                      step="0.00001"
                      value={longitude}
                      onChange={(e) => setLongitude(e.target.value)}
                      placeholder="-118.24368"
                    />
                  </div>
                </div>
              </div>

              <hr className="border-border" />

              {/* Geofence settings */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="font-label text-label-md uppercase tracking-wider text-muted-foreground">
                    Geofence Boundary
                  </h3>
                  <Badge variant="success" dot>Active</Badge>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="site-radius" className="font-label text-label-md">Radius (Meters)</Label>
                    <span className="text-body-md font-bold text-foreground">{radiusInMeters || 0}m</span>
                  </div>
                  <input
                    id="site-radius"
                    type="range"
                    min={50}
                    max={1000}
                    step={10}
                    value={radiusInMeters}
                    onChange={(e) => setRadiusInMeters(e.target.value)}
                    className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-muted accent-primary"
                  />
                  <div className="mt-1 flex justify-between font-label text-label-sm text-muted-foreground">
                    <span>50m</span>
                    <span>1000m</span>
                  </div>
                  <Input
                    type="number"
                    value={radiusInMeters}
                    onChange={(e) => setRadiusInMeters(e.target.value)}
                    className="mt-2 max-w-32"
                    aria-label="Exact radius in meters"
                  />
                </div>
              </div>

              <hr className="border-border" />

              {/* Assigned staff */}
              {selectedSite && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="flex items-center gap-2 font-label text-label-md uppercase tracking-wider text-muted-foreground">
                      <Users className="h-4 w-4" /> Assigned Staff
                    </h3>
                    <span className="font-label text-label-md text-primary">
                      {assignedStaff.length} assigned
                    </span>
                  </div>
                  <div className="overflow-hidden rounded-md border border-border">
                    <div className="max-h-48 overflow-y-auto">
                      <table className="w-full border-collapse text-left">
                        <thead className="sticky top-0 bg-muted">
                          <tr>
                            <th className="border-b border-border px-3 py-2 font-label text-label-sm font-semibold text-foreground">Employee</th>
                            <th className="border-b border-border px-3 py-2 font-label text-label-sm font-semibold text-foreground">Role</th>
                            <th className="border-b border-border px-3 py-2 text-right font-label text-label-sm font-semibold text-foreground">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border font-body text-body-sm">
                          {assignedStaff.map(({ assignment, employee }) => (
                            <tr key={`${assignment.employee_id}-${assignment.site_id}`} className="row-hover transition-colors">
                              <td className="px-3 py-2 text-foreground">
                                {employee ? `${employee.first_name} ${employee.last_name}` : 'Unknown'}
                              </td>
                              <td className="px-3 py-2 text-muted-foreground">
                                {employee?.designations?.name ?? '—'}
                              </td>
                              <td className="px-3 py-2 text-right">
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 text-destructive hover:text-destructive"
                                  onClick={() => handleUnassign(assignment.employee_id, assignment.site_id)}
                                >
                                  Unassign
                                </Button>
                              </td>
                            </tr>
                          ))}
                          {assignedStaff.length === 0 && (
                            <tr>
                              <td colSpan={3} className="px-3 py-6 text-center text-body-sm text-muted-foreground">
                                No staff assigned. Use the Assignments page or an employee's profile.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="sticky bottom-0 flex items-center justify-between gap-3 border-t border-border bg-card p-4">
              {selectedSite ? (
                <Button
                  variant="ghost"
                  className="text-destructive hover:bg-red-500/10 hover:text-destructive"
                  onClick={() => handleDelete(selectedSite.id)}
                >
                  <Trash2 className="mr-2 h-4 w-4" /> Delete
                </Button>
              ) : (
                <span />
              )}
              <div className="flex gap-3">
                <Button variant="outline" onClick={closePanel} disabled={mutation.isPending}>
                  Cancel
                </Button>
                <Button
                  onClick={() => mutation.mutate()}
                  disabled={mutation.isPending || !name || !latitude || !longitude}
                >
                  {mutation.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
                  Save Changes
                </Button>
              </div>
            </div>
          </aside>
        )}
      </div>

      {/* Map pin hint footer */}
      <p className="flex items-center gap-2 text-body-sm text-muted-foreground">
        <MapPin className="h-4 w-4" />
        Geofence radius determines whether employee GPS pings register as inside or outside the site.
      </p>
    </div>
  )
}
