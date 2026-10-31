import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { MapPin, Plus } from 'lucide-react'
import { createSite, fetchSites } from '@/api/services'
import { MapCanvas, type MapCircle, type MapMarker } from '@/components/map/MapCanvas'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { InlineSpinner } from '@/components/ui/states'
import type { LatLng } from '@/lib/geo'
import type { SetupStepInfo } from '@/lib/setupWizard'
import { Field, StepFrame } from './SetupSteps'

// 300 m covers most sites and keeps automatic check-in reliable on phone GPS.
const errorText = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback)
const DEFAULT_RADIUS = 300
const INDIA = { lat: 20.5937, lng: 78.9629 }

export function SitesStep({ info, onBack, onDone }: { info: SetupStepInfo; onBack: () => void; onDone: () => void }) {
  const queryClient = useQueryClient()
  const sites = useQuery({ queryKey: ['sites'], queryFn: fetchSites })
  const [name, setName] = useState('')
  const [position, setPosition] = useState<LatLng | null>(null)
  const [radius, setRadius] = useState(String(DEFAULT_RADIUS))
  const [view, setView] = useState<{ center: LatLng; zoom: number; key: number }>({ center: INDIA, zoom: 5, key: 0 })
  const [errors, setErrors] = useState<string[]>([])

  const radiusValue = Number(radius)
  const place = (next: LatLng, zoomIn: boolean) => {
    setPosition(next)
    if (zoomIn) setView({ center: next, zoom: 16, key: Date.now() })
  }

  const add = useMutation({
    mutationFn: async () => {
      const problems = [
        !name.trim() && 'Name the site.',
        !position && 'Search for the address or click the map to place the site.',
        !(Number.isFinite(radiusValue) && radiusValue >= 10 && radiusValue <= 50_000) && 'The radius must be 10 to 50,000 metres.',
      ].filter(Boolean) as string[]
      setErrors(problems)
      if (problems.length || !position) return false
      await createSite({ name: name.trim(), latitude: position.lat, longitude: position.lng, radius_in_meters: Math.round(radiusValue) })
      return true
    },
    onSuccess: (added) => {
      if (!added) return
      queryClient.invalidateQueries({ queryKey: ['sites'] })
      setName('')
      setPosition(null)
      setRadius(String(DEFAULT_RADIUS))
    },
  })

  const { markers, circles } = useMemo(() => {
    const saved = sites.data ?? []
    const markers: MapMarker[] = saved.map((site) => ({
      id: site.id, position: { lat: site.latitude, lng: site.longitude }, label: site.name, tone: 'muted',
    }))
    const circles: MapCircle[] = saved.map((site) => ({
      id: site.id, center: { lat: site.latitude, lng: site.longitude }, radiusMeters: site.radius_in_meters, label: site.name, tone: 'saved',
    }))
    if (position) {
      markers.push({ id: 'draft', position, label: name.trim() || 'New site', tone: 'selected' })
      if (radiusValue >= 10) circles.push({ id: 'draft', center: position, radiusMeters: radiusValue, tone: 'draft' })
    }
    return { markers, circles }
  }, [sites.data, position, name, radiusValue])

  if (sites.isLoading) return <InlineSpinner />
  const count = sites.data?.length ?? 0
  return (
    <StepFrame info={info} asForm={false} onBack={onBack} onSkip={count ? undefined : onDone} onSubmit={onDone}
      submitLabel="Continue" submitDisabled={!count || add.isPending}
      errors={add.error ? [errorText(add.error, 'Could not add the site.')] : errors}>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_15rem]">
        <div className="relative h-80 overflow-hidden rounded-xl border border-border/80 lg:h-96">
          <MapCanvas
            center={view.center}
            zoom={view.zoom}
            focusKey={view.key}
            markers={markers}
            circles={circles}
            onMapClick={(next) => place(next, false)}
            onSearchSelect={(next, label) => {
              place(next, true)
              if (!name.trim()) setName(label.split(',')[0].trim().slice(0, 80))
            }}
            onLocate={(next) => place(next, true)}
            className="absolute inset-0 h-full"
            ariaLabel="Map for placing a work site"
          />
        </div>
        <div className="flex flex-col gap-3">
          <Field id="site-name" label="Site name">
            <Input id="site-name" value={name} maxLength={80} placeholder="Head office, Whitefield site…" onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field id="site-radius" label="Geofence radius (metres)" hint="People within this distance of the pin count as on site.">
            <Input id="site-radius" inputMode="numeric" value={radius} onChange={(e) => setRadius(e.target.value)} />
          </Field>
          <p className="text-label-sm text-muted-foreground">
            {position ? `Pin at ${position.lat.toFixed(5)}, ${position.lng.toFixed(5)}` : 'Search above the map or click it to drop the pin.'}
          </p>
          <Button type="button" variant="outline" className="gap-2" onClick={() => add.mutate()} disabled={add.isPending}>
            <Plus className="h-4 w-4" />
            {add.isPending ? 'Adding…' : 'Add site'}
          </Button>
        </div>
      </div>

      {count > 0 ? (
        <ul className="divide-y divide-border/70 rounded-xl border border-border/80">
          {sites.data!.map((site) => (
            <li key={site.id} className="flex items-center gap-3 px-4 py-2.5">
              <MapPin className="h-4 w-4 text-primary" />
              <span className="font-semibold text-foreground">{site.name}</span>
              <span className="text-body-sm text-muted-foreground">{Math.round(site.radius_in_meters)} m radius</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-body-sm text-muted-foreground">No sites yet. Add at least one, or skip and add sites later under Sites &amp; Geofences.</p>
      )}
    </StepFrame>
  )
}
