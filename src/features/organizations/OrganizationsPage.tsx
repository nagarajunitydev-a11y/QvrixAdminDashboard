import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import { useOrganization } from '@/hooks/useOrganization'
import { saveOrganization } from '@/api/organizations'
import type { Organization } from '@/types/organization'
import { Button } from '@/components/ui/button'
import { DataTable } from '@/components/ui/data-table'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useConfirm } from '@/hooks/useConfirm'

export function OrganizationsPage() {
  const {
    organizations,
    isPlatformAdmin,
    refreshOrganizations,
    switchOrganization,
  } = useOrganization()
  const [editing, setEditing] = useState<Partial<Organization> | null>(null)
  const [error, setError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const navigate = useNavigate()
  const confirm = useConfirm()
  const mutation = useMutation({
    mutationFn: saveOrganization,
    onSuccess: async () => {
      setEditing(null)
      await refreshOrganizations()
    },
    onError: (error) => setError(error.message),
  })
  if (!isPlatformAdmin)
    return (
      <div className="card p-8">
        <h1 className="page-heading">Platform administrator access required</h1>
        <p className="page-subtitle">
          Organization management is restricted to authorized platform
          administrators.
        </p>
      </div>
    )
  const edit = (org: Partial<Organization>) => {
    setError('')
    setEditing(org)
  }
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="eyebrow">CREWTRAXA WORKFORCE</p>
          <h1 className="page-heading mt-2">Organizations</h1>
          <p className="page-subtitle">
            Manage organization lifecycle, time zones, and workspace
            configuration.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            disabled={refreshing}
            onClick={async () => {
              setRefreshing(true)
              try {
                await refreshOrganizations()
              } finally {
                setRefreshing(false)
              }
            }}
          >
            {refreshing ? 'Refreshing…' : 'Refresh organizations'}
          </Button>
          <Button
            onClick={() =>
              edit({ name: '', status: 'active', timezone: 'Asia/Kolkata' })
            }
          >
            Create organization
          </Button>
        </div>
      </div>
      {error && !editing && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      <div className="card overflow-hidden">
        <DataTable
          data={organizations}
          columns={[
            { header: 'Organization', accessor: 'name' },
            { header: 'UUID', accessor: 'id', className: 'text-xs font-mono' },
            {
              header: 'Status',
              accessor: (row) => (
                <Badge
                  dot
                  variant={row.status === 'active' ? 'success' : 'warning'}
                >
                  {row.status}
                </Badge>
              ),
            },
            { header: 'Time zone', accessor: 'timezone' },
            {
              header: 'Actions',
              accessor: (row) => (
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => edit(row)}>
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={row.status !== 'active'}
                    onClick={async () => {
                      try {
                        await switchOrganization(row.id)
                        navigate('/')
                      } catch (error) {
                        setError(
                          error instanceof Error
                            ? error.message
                            : 'Organization unavailable',
                        )
                      }
                    }}
                  >
                    Open workspace
                  </Button>
                </div>
              ),
            },
          ]}
        />
      </div>
      <Dialog
        open={!!editing}
        onOpenChange={(open) => {
          if (!open) setEditing(null)
        }}
      >
        <DialogContent>
          <DialogTitle>
            {editing?.id ? 'Edit organization' : 'Create organization'}
          </DialogTitle>
          <DialogDescription>
            Suspending an organization blocks business data access for its
            members.
          </DialogDescription>
          {editing && (
            <form
              className="space-y-4"
              onSubmit={async (event) => {
                event.preventDefault()
                if (
                  editing.status === 'suspended' &&
                  !(await confirm(
                    'Suspend this organization? Members will lose access to its business data.',
                  ))
                )
                  return
                mutation.mutate({
                  ...editing,
                  name: editing.name || '',
                  timezone: editing.timezone || 'Asia/Kolkata',
                  status: editing.status || 'active',
                })
              }}
            >
              <label className="block space-y-2 text-sm">
                Name
                <Input
                  required
                  maxLength={160}
                  value={editing.name || ''}
                  onChange={(e) =>
                    setEditing({ ...editing, name: e.target.value })
                  }
                />
              </label>
              <label className="block space-y-2 text-sm">
                Time zone
                <Input
                  required
                  value={editing.timezone || ''}
                  placeholder="Asia/Kolkata"
                  onChange={(e) =>
                    setEditing({ ...editing, timezone: e.target.value })
                  }
                />
              </label>
              <label className="block space-y-2 text-sm">
                Status
                <select
                  aria-label="Status"
                  className="h-10 w-full rounded-lg border bg-card px-3"
                  value={editing.status}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      status: e.target.value as Organization['status'],
                    })
                  }
                >
                  <option value="active">Active</option>
                  <option value="suspended">Suspended</option>
                </select>
              </label>
              {editing.id && (
                <p className="break-all text-xs text-muted-foreground">
                  UUID: {editing.id}
                </p>
              )}
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setEditing(null)}
                >
                  Cancel
                </Button>
                <Button disabled={mutation.isPending}>
                  {mutation.isPending ? 'Saving…' : 'Save organization'}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
