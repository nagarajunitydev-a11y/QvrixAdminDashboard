import { useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Landmark } from 'lucide-react'
import { useOrganization } from '@/api/OrganizationProvider'
import { updateOrganization } from '@/api/organizations'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { useToast } from '@/components/ui/toast'
import { roleLabels } from '@/lib/consoleAccess'

const timeZones = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : []

export function OrganizationSettings() {
  const { organization, role, isOrgAdmin } = useOrganization()
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [name, setName] = useState(organization?.name ?? '')
  const [timezone, setTimezone] = useState(organization?.timezone ?? 'Asia/Kolkata')

  const save = useMutation({
    mutationFn: () => updateOrganization(organization!.id, { name: name.trim(), timezone: timezone.trim() }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['console-access'] })
      toast({ title: 'Organization updated' })
    },
  })

  if (!organization) return null
  const dirty = name.trim() !== organization.name || timezone.trim() !== organization.timezone

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (dirty && name.trim()) save.mutate()
  }

  return (
    <section className="surface-panel p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-headline text-headline-md text-foreground">Organization</h2>
          <p className="mt-0.5 text-body-sm text-muted-foreground">
            Sites, employees, attendance and devices in this Console belong to this organization.
          </p>
        </div>
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary ring-1 ring-inset ring-primary/15">
          <Landmark className="h-4 w-4" />
        </span>
      </div>
      <form onSubmit={submit} className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="organization-name">Name</Label>
          <Input
            id="organization-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            disabled={!isOrgAdmin}
            maxLength={120}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="organization-timezone">Time zone</Label>
          <Input
            id="organization-timezone"
            list="organization-timezones"
            value={timezone}
            onChange={(event) => setTimezone(event.target.value)}
            disabled={!isOrgAdmin}
          />
          <datalist id="organization-timezones">
            {timeZones.map((zone) => <option key={zone} value={zone} />)}
          </datalist>
        </div>
        {save.error && (
          <Alert variant="destructive" className="sm:col-span-2">
            <AlertDescription>{save.error.message}</AlertDescription>
          </Alert>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2 sm:col-span-2">
          <p className="flex items-center gap-2 text-[11px] text-muted-foreground">
            Workspace ID <span className="font-mono">{organization.slug}</span>
            {role && <Badge variant="outline">{roleLabels[role]}</Badge>}
          </p>
          {isOrgAdmin ? (
            <Button type="submit" size="sm" disabled={!dirty || !name.trim() || save.isPending}>
              {save.isPending ? 'Saving...' : 'Save organization'}
            </Button>
          ) : (
            <p className="text-[11px] text-muted-foreground">Only organization admins can change these settings.</p>
          )}
        </div>
      </form>
    </section>
  )
}
