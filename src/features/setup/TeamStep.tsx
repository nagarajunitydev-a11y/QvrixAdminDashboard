import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Smartphone, Trash2, UserCog } from 'lucide-react'
import { assignEmployeesToSite, fetchEmployees, fetchSites, inviteEmployees } from '@/api/services'
import { inviteOrganizationMember } from '@/api/organizations'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { InlineSpinner } from '@/components/ui/states'
import { roleLabels } from '@/lib/consoleAccess'
import { validateInvites, type EmployeeInviteRow, type ManagerInviteRow, type SetupStepInfo } from '@/lib/setupWizard'
import { StepFrame } from './SetupSteps'

const errorText = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback)
const emptyEmployee = (): EmployeeInviteRow => ({ firstName: '', lastName: '', email: '', phone: '' })
const emptyManager = (): ManagerInviteRow => ({ email: '', role: 'manager' })
const MAX_ROWS = 25

export function TeamStep({ info, onBack, onDone }: { info: SetupStepInfo; onBack: () => void; onDone: () => void }) {
  const queryClient = useQueryClient()
  const employees = useQuery({ queryKey: ['employees'], queryFn: fetchEmployees })
  const sites = useQuery({ queryKey: ['sites'], queryFn: fetchSites })
  const [rows, setRows] = useState<EmployeeInviteRow[]>(() => [emptyEmployee(), emptyEmployee(), emptyEmployee()])
  const [managers, setManagers] = useState<ManagerInviteRow[]>(() => [emptyManager()])
  const [assignAll, setAssignAll] = useState(true)
  const [errors, setErrors] = useState<string[]>([])
  const siteList = sites.data ?? []

  const existing = new Set((employees.data ?? []).map((e) => e.email.toLowerCase()))
  const setRow = (index: number, changes: Partial<EmployeeInviteRow>) => setRows(rows.map((row, i) => (i === index ? { ...row, ...changes } : row)))
  const setManager = (index: number, changes: Partial<ManagerInviteRow>) => setManagers(managers.map((row, i) => (i === index ? { ...row, ...changes } : row)))

  const mutation = useMutation({
    mutationFn: async () => {
      const result = validateInvites(rows, managers, existing)
      setErrors(result.errors)
      if (result.errors.length) return false
      if (result.employees.length) {
        const ids = await inviteEmployees(result.employees)
        // The app tracks only the sites an employee is assigned to.
        if (assignAll) for (const site of siteList) await assignEmployeesToSite(ids, site.id)
      }
      const failed: string[] = []
      for (const manager of result.managers) {
        try {
          await inviteOrganizationMember(manager.email, manager.role)
        } catch (error) {
          failed.push(`${manager.email}: ${errorText(error, 'not invited')}`)
        }
      }
      queryClient.invalidateQueries({ queryKey: ['employees'] })
      queryClient.invalidateQueries({ queryKey: ['organization-invitations'] })
      if (failed.length) {
        setErrors([`Employees were saved, but some Console invitations were not sent. ${failed.join('; ')}`])
        setManagers(managers.filter((m) => failed.some((f) => f.startsWith(m.email.trim().toLowerCase()))))
        setRows([emptyEmployee()])
        return false
      }
      return true
    },
    onSuccess: (saved) => { if (saved) onDone() },
  })

  if (employees.isLoading || sites.isLoading) return <InlineSpinner />
  const anything = rows.some((r) => r.firstName || r.lastName || r.email || r.phone) || managers.some((m) => m.email.trim())
  return (
    <StepFrame info={info} onBack={onBack} onSkip={onDone} pending={mutation.isPending} onSubmit={() => mutation.mutate()}
      submitLabel={anything ? 'Save and continue' : 'Continue'} submitDisabled={!anything}
      errors={mutation.error ? [errorText(mutation.error, 'Could not save the invitations.')] : errors}>
      <section className="flex flex-col gap-3">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><Smartphone className="h-4 w-4" /></span>
          <div>
            <h2 className="font-label text-label-md font-semibold text-foreground">Employees</h2>
            <p className="text-body-sm text-muted-foreground">
              They sign in to the Crewtraxa app with this email and accept your invitation. They do not get Console access.
              {employees.data?.length ? ` ${employees.data.length} already added.` : ''}
            </p>
          </div>
        </div>
        <div className="flex flex-col gap-2">
          {rows.map((row, index) => (
            <div key={index} className="grid grid-cols-2 gap-2 sm:grid-cols-[1fr_1fr_1.4fr_1fr_auto]">
              <Input aria-label={`Employee ${index + 1} first name`} placeholder="First name" value={row.firstName} maxLength={60}
                onChange={(e) => setRow(index, { firstName: e.target.value })} />
              <Input aria-label={`Employee ${index + 1} last name`} placeholder="Last name" value={row.lastName} maxLength={60}
                onChange={(e) => setRow(index, { lastName: e.target.value })} />
              <Input aria-label={`Employee ${index + 1} email`} type="email" placeholder="Email" value={row.email} className="col-span-2 sm:col-span-1"
                onChange={(e) => setRow(index, { email: e.target.value })} />
              <Input aria-label={`Employee ${index + 1} phone`} type="tel" placeholder="Phone (optional)" value={row.phone}
                onChange={(e) => setRow(index, { phone: e.target.value })} />
              <Button type="button" size="icon" variant="ghost" title="Remove row" className="hover:text-destructive"
                onClick={() => setRows(rows.length > 1 ? rows.filter((_, i) => i !== index) : [emptyEmployee()])}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <Button type="button" variant="outline" size="sm" className="gap-2" disabled={rows.length >= MAX_ROWS}
            onClick={() => setRows([...rows, emptyEmployee()])}>
            <Plus className="h-4 w-4" />
            Add another
          </Button>
          {siteList.length > 0 && (
            <label className="flex items-center gap-2 text-body-sm">
              <input type="checkbox" className="h-4 w-4 rounded border-input accent-primary" checked={assignAll} onChange={(e) => setAssignAll(e.target.checked)} />
              Assign them to {siteList.length === 1 ? siteList[0].name : `all ${siteList.length} sites`}
            </label>
          )}
        </div>
        <p className="text-label-sm text-muted-foreground">Many people? Import a CSV file from Employees after setup.</p>
      </section>

      <section className="flex flex-col gap-3 border-t border-border/70 pt-5">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><UserCog className="h-4 w-4" /></span>
          <div>
            <h2 className="font-label text-label-md font-semibold text-foreground">Managers and supervisors (optional)</h2>
            <p className="text-body-sm text-muted-foreground">
              People who use this Console. They accept the invitation after signing in with this email; it expires in 14 days.
            </p>
          </div>
        </div>
        {managers.map((row, index) => (
          <div key={index} className="grid grid-cols-[1fr_11rem_auto] gap-2">
            <Input aria-label={`Console user ${index + 1} email`} type="email" placeholder="Email" value={row.email}
              onChange={(e) => setManager(index, { email: e.target.value })} />
            <Select value={row.role} onValueChange={(role) => setManager(index, { role: role as ManagerInviteRow['role'] })}>
              <SelectTrigger aria-label={`Console user ${index + 1} role`}><SelectValue /></SelectTrigger>
              <SelectContent>
                {(['org_admin', 'manager', 'supervisor'] as const).map((role) => <SelectItem key={role} value={role}>{roleLabels[role]}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button type="button" size="icon" variant="ghost" title="Remove row" className="hover:text-destructive"
              onClick={() => setManagers(managers.length > 1 ? managers.filter((_, i) => i !== index) : [emptyManager()])}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
        <div>
          <Button type="button" variant="outline" size="sm" className="gap-2" disabled={managers.length >= 10}
            onClick={() => setManagers([...managers, emptyManager()])}>
            <Plus className="h-4 w-4" />
            Add another
          </Button>
        </div>
      </section>
    </StepFrame>
  )
}
