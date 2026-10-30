import { useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowRightLeft, Landmark, Lock, Plus } from 'lucide-react'
import { useOrganization } from '@/api/OrganizationProvider'
import { createOrganization } from '@/api/organizations'
import { PageHeader } from '@/components/ui/page-header'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { EmptyState } from '@/components/ui/states'
import { useToast } from '@/components/ui/toast'
import { roleLabels } from '@/lib/consoleAccess'

function slugify(name: string) {
  return name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 63)
}

export function OrganizationsPage() {
  const { organizations, organization: active, isPlatformAdmin, switchOrganization } = useOrganization()
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [slugEdited, setSlugEdited] = useState(false)
  const [timezone, setTimezone] = useState('Asia/Kolkata')
  const [adminEmail, setAdminEmail] = useState('')

  const create = useMutation({
    mutationFn: () => createOrganization({ name: name.trim(), slug: slug.trim(), timezone: timezone.trim(), adminEmail: adminEmail.trim() }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['console-access'] })
      toast({ title: 'Organization created', description: name.trim() })
      setName('')
      setSlug('')
      setSlugEdited(false)
      setAdminEmail('')
    },
  })

  if (!isPlatformAdmin) {
    return (
      <div className="page-shell">
        <EmptyState
          icon={Lock}
          title="Platform administrators only"
          description="Organizations are created by Crewtraxa platform administrators. Organization settings are under Settings."
        />
      </div>
    )
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (name.trim() && slug.trim()) create.mutate()
  }

  return (
    <div className="page-shell">
      <PageHeader
        eyebrow="Platform"
        title="Organizations"
        description="Every organization's employees, sites, attendance and devices are isolated by the database."
        icon={Landmark}
      />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <section className="surface-panel overflow-hidden">
          <ul className="divide-y divide-border/60">
            {organizations.map((organization) => (
              <li key={organization.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="truncate font-label text-label-md text-foreground">{organization.name}</p>
                  <p className="text-[11px] text-muted-foreground">
                    <span className="font-mono">{organization.slug}</span> · {organization.timezone}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {!organization.is_active && <Badge variant="secondary">Inactive</Badge>}
                  <Badge variant="outline">{roleLabels[organization.role]}</Badge>
                  {organization.id === active?.id ? (
                    <Badge variant="success" dot>Current</Badge>
                  ) : (
                    <Button size="sm" variant="outline" className="gap-1" onClick={() => switchOrganization(organization.id)}>
                      <ArrowRightLeft className="h-3.5 w-3.5" /> Open
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>

        <form onSubmit={submit} className="surface-panel space-y-3 p-4">
          <h2 className="flex items-center gap-2 font-headline text-headline-sm text-foreground">
            <Plus className="h-4 w-4 text-primary" /> New organization
          </h2>
          <div className="space-y-1.5">
            <Label htmlFor="org-name">Name</Label>
            <Input
              id="org-name"
              value={name}
              maxLength={120}
              onChange={(event) => {
                setName(event.target.value)
                if (!slugEdited) setSlug(slugify(event.target.value))
              }}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="org-slug">Workspace ID</Label>
            <Input
              id="org-slug"
              value={slug}
              onChange={(event) => {
                setSlugEdited(true)
                setSlug(event.target.value.toLowerCase())
              }}
              pattern="[a-z0-9][a-z0-9\-]{1,62}"
              title="Lowercase letters, numbers and hyphens"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="org-timezone">Time zone</Label>
            <Input id="org-timezone" value={timezone} onChange={(event) => setTimezone(event.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="org-admin">First organization admin (optional)</Label>
            <Input
              id="org-admin"
              type="email"
              value={adminEmail}
              onChange={(event) => setAdminEmail(event.target.value)}
              placeholder="Confirmed account email"
            />
          </div>
          {create.error && (
            <Alert variant="destructive">
              <AlertDescription>{create.error.message}</AlertDescription>
            </Alert>
          )}
          <Button type="submit" className="w-full" disabled={!name.trim() || !slug.trim() || create.isPending}>
            {create.isPending ? 'Creating...' : 'Create organization'}
          </Button>
        </form>
      </div>
    </div>
  )
}
