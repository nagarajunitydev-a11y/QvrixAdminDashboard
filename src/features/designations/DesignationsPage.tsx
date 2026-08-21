import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  fetchDesignations,
  createDesignation,
  updateDesignation,
  deleteDesignation,
} from '@/api/services'
import { Designation, DesignationInsert, DesignationUpdate } from '@/types'
import { DataTable } from '@/components/ui/data-table'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Plus, Edit, Trash2 } from 'lucide-react'

export function DesignationsPage() {
  const queryClient = useQueryClient()
  const { data: designations = [], isLoading } = useQuery({
    queryKey: ['designations'],
    queryFn: fetchDesignations,
  })
  const [editing, setEditing] = useState<Designation | null>(null)
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [error, setError] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: async () => {
      const payload: DesignationInsert = {
        name,
        description: description || null,
      }
      if (editing) {
        await updateDesignation(editing.id, payload as DesignationUpdate)
      } else {
        await createDesignation(payload)
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['designations'] })
      setIsFormOpen(false)
      setEditing(null)
      setName('')
      setDescription('')
      setError(null)
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : 'Failed to save designation')
    },
  })

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this designation?')) return
    try {
      await deleteDesignation(id)
      setError(null)
      queryClient.invalidateQueries({ queryKey: ['designations'] })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete designation')
    }
  }

  const handleEdit = (d: Designation) => {
    setEditing(d)
    setName(d.name)
    setDescription(d.description ?? '')
    setError(null)
    setIsFormOpen(true)
  }

  const handleAdd = () => {
    setEditing(null)
    setName('')
    setDescription('')
    setError(null)
    setIsFormOpen(true)
  }

  const handleCloseForm = () => {
    setIsFormOpen(false)
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
          <h1 className="font-headline text-headline-lg text-foreground">Designations</h1>
          <p className="mt-1 text-body-sm text-muted-foreground">Manage job titles and designations.</p>
        </div>
        <Button onClick={handleAdd} className="shrink-0 gap-2">
          <Plus className="h-4 w-4" />
          Add Designation
        </Button>
      </div>

      {error && !isFormOpen && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Designations</CardTitle>
          <CardDescription>{designations.length} total designations</CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={[
              { header: 'Name', accessor: 'name' },
              { header: 'Description', accessor: 'description' },
              { header: 'Actions', accessor: (row) => row.actions, className: 'text-right' },
            ]}
            data={designations.map((d) => ({
              ...d,
              actions: (
                <div className="flex justify-end gap-1">
                  <Button size="icon" variant="ghost" title="Edit" onClick={() => handleEdit(d)}>
                    <Edit className="h-4 w-4" />
                  </Button>
                  <Button size="icon" variant="ghost" title="Delete" className="hover:text-destructive" onClick={() => handleDelete(d.id)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ),
            }))}
          />
        </CardContent>
      </Card>

      <Dialog open={isFormOpen} onOpenChange={(open) => (open ? setIsFormOpen(true) : handleCloseForm())}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit' : 'Add'} Designation</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <div className="space-y-2">
              <Label htmlFor="name">Name *</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={handleCloseForm} disabled={mutation.isPending}>
              Cancel
            </Button>
            <Button
              onClick={() => mutation.mutate()}
              disabled={mutation.isPending || !name}
            >
              {mutation.isPending ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
