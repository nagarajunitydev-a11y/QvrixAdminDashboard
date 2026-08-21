import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchAuditLogs } from '@/api/services'
import { AuditLog } from '@/types'
import { DataTable } from '@/components/ui/data-table'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { formatDistanceToNow } from 'date-fns'
import { Filter, Search, ScrollText, Plus, Pencil, Trash2 } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

export function AuditLogsPage() {
  const [tableNameFilter, setTableNameFilter] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState('')

  const { data: logs = [], isLoading } = useQuery({
    queryKey: ['audit-logs', { tableName: tableNameFilter }],
    queryFn: () => fetchAuditLogs({ tableName: tableNameFilter ?? undefined, limit: 200 }),
  })

  if (isLoading) {
    return (
      <div className="flex justify-center py-16">
        <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-primary" />
      </div>
    )
  }

  const filteredLogs = logs.filter(
    (log) =>
      log.action.toLowerCase().includes(searchTerm.toLowerCase()) ||
      log.table_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (log.record_id ?? '').includes(searchTerm)
  )

  const actionVariants = {
    INSERT: 'success',
    UPDATE: 'warning',
    DELETE: 'destructive',
  } as const

  const actionIcons = {
    INSERT: Plus,
    UPDATE: Pencil,
    DELETE: Trash2,
  } as const

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div>
        <h1 className="font-headline text-headline-lg text-foreground">Audit Logs</h1>
        <p className="mt-1 text-body-sm text-muted-foreground">
          Track all administrative actions across the system.
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-3">
          <div className="min-w-[180px] flex-1 sm:max-w-64">
            <Select value={tableNameFilter ?? ''} onValueChange={setTableNameFilter}>
              <SelectTrigger>
                <Filter className="mr-2 h-4 w-4 shrink-0" />
                <SelectValue placeholder="Filter by table" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">All tables</SelectItem>
                <SelectItem value="employees">Employees</SelectItem>
                <SelectItem value="departments">Departments</SelectItem>
                <SelectItem value="designations">Designations</SelectItem>
                <SelectItem value="shifts">Shifts</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="relative min-w-[200px] flex-1 sm:max-w-72">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search logs…"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>
        </div>
        <span className="shrink-0 font-label text-label-md text-muted-foreground">
          {filteredLogs.length} records found
        </span>
      </div>

      {/* Logs table */}
      <Card className="overflow-hidden">
        <CardContent className="p-0 pt-0">
          <DataTable
            columns={[
              {
                header: 'Action',
                accessor: (row: AuditLog) => {
                  const variant = actionVariants[row.action as keyof typeof actionVariants] ?? 'outline'
                  const Icon = actionIcons[row.action as keyof typeof actionIcons] ?? ScrollText
                  return (
                    <Badge variant={variant} dot={variant === 'success' || variant === 'warning' || variant === 'destructive'}>
                      <Icon className="h-3 w-3" />
                      {row.action}
                    </Badge>
                  )
                },
              },
              {
                header: 'Table',
                accessor: (row: AuditLog) => (
                  <span className="font-label text-label-md">{row.table_name}</span>
                ),
              },
              {
                header: 'Record ID',
                accessor: (row: AuditLog) => (
                  <span className="font-label text-label-md tabular-nums text-muted-foreground">
                    {row.record_id ?? '—'}
                  </span>
                ),
              },
              {
                header: 'Time',
                accessor: (row: AuditLog) =>
                  formatDistanceToNow(new Date(row.created_at), { addSuffix: true }),
              },
              {
                header: 'New Values',
                accessor: (row: AuditLog) => row.new_values
                  ? JSON.stringify(row.new_values).slice(0, 50) + '...'
                  : '—',
              },
            ]}
            data={filteredLogs}
          />
        </CardContent>
      </Card>
    </div>
  )
}
