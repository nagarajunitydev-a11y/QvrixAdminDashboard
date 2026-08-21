import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  fetchDepartments,
  createDepartment,
  updateDepartment,
  deleteDepartment,
} from '@/api/services'
import { Department, DepartmentInsert, DepartmentUpdate } from '@/types'
import { DataTable } from '@/components/ui/data-table'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Plus, Edit, Trash2 } from 'lucide-react'

export function DepartmentsPage() {
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState<Department | null>(null)
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [error, setError] = useState<string | null>(null)

  const { data: departments = [], isLoading } = useQuery({
    queryKey: ['departments'],
    queryFn: fetchDepartments,
  })

  const mutation = useMutation({
    mutationFn: async () => {
      const payload: DepartmentInsert = {
        name,
        description: description || null,
      }
      if (editing) {
        await updateDepartment(editing.id, payload as DepartmentUpdate)
      } else {
        await createDepartment(payload)
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['departments'] })
      setIsFormOpen(false)
      setEditing(null)
      setName('')
      setDescription('')
      setError(null)
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : 'Failed to save department')
    },
  })

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this department? This cannot be undone.')) return
    try {
      await deleteDepartment(id)
      setError(null)
      queryClient.invalidateQueries({ queryKey: ['departments'] })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete department')
    }
  }

  const handleEdit = (dept: Department) => {
    setEditing(dept)
    setName(dept.name)
    setDescription(dept.description ?? '')
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
          <h1 className="font-headline text-headline-lg text-foreground">Departments</h1>
          <p className="mt-1 text-body-sm text-muted-foreground">Manage organizational departments.</p>
        </div>
        <Button onClick={handleAdd} className="shrink-0 gap-2">
          <Plus className="h-4 w-4" />
          Add Department
        </Button>
      </div>

      {error && !isFormOpen && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Departments</CardTitle>
          <CardDescription>{departments.length} total departments</CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={[
              { header: 'Name', accessor: 'name' },
              { header: 'Description', accessor: 'description' },
              { header: 'Actions', accessor: (row) => row.actions, className: 'text-right' },
            ]}
            data={departments.map((d) => ({
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
            <DialogTitle>{editing ? 'Edit' : 'Add'} Department</DialogTitle>
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
              type="submit"
              disabled={mutation.isPending || !name}
              onClick={() => mutation.mutate()}
            >
              {mutation.isPending ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
