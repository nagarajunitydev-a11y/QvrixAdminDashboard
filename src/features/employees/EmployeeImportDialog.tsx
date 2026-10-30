import { useMemo, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2, Download, FileUp } from 'lucide-react'
import { importEmployees } from '@/api/services'
import type { EmployeeWithRelations } from '@/api/services'
import type { Department, Designation, Shift } from '@/types'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/components/ui/toast'
import { downloadCsv } from '@/lib/format'
import {
  IMPORT_COLUMNS,
  IMPORT_TEMPLATE_ROWS,
  REQUIRED_COLUMNS,
  buildImportPreview,
  parseCsv,
  type ImportPreview,
} from '@/lib/employeeImport'

const MAX_FILE_BYTES = 2 * 1024 * 1024

export function EmployeeImportDialog({
  open,
  onOpenChange,
  employees,
  departments,
  designations,
  shifts,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  employees: EmployeeWithRelations[]
  departments: Department[]
  designations: Designation[]
  shifts: Shift[]
}) {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const inputRef = useRef<HTMLInputElement>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [table, setTable] = useState<string[][] | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)

  // Recomputed against the latest records, so a second import of the same file flags what now exists.
  const preview: ImportPreview | null = useMemo(() => {
    if (!table) return null
    return buildImportPreview(table, {
      existingEmails: employees.map((e) => e.email),
      existingCodes: employees.flatMap((e) => (e.employee_code ? [e.employee_code] : [])),
      departments,
      designations,
      shifts,
    })
  }, [table, employees, departments, designations, shifts])

  const clearFile = () => {
    setFileName(null)
    setTable(null)
    setFileError(null)
    if (inputRef.current) inputRef.current.value = ''
  }

  const importMutation = useMutation({
    mutationFn: async () => {
      if (!preview) return 0
      const rows = preview.rows.flatMap((row) => (row.payload ? [row.payload] : []))
      return importEmployees(rows, preview.newDepartments, preview.newDesignations)
    },
    onSuccess: (count) => {
      void queryClient.invalidateQueries({ queryKey: ['employees'] })
      void queryClient.invalidateQueries({ queryKey: ['departments'] })
      void queryClient.invalidateQueries({ queryKey: ['designations'] })
      void queryClient.invalidateQueries({ queryKey: ['onboarding-counts'] })
      toast({ title: `Imported ${count} employee${count === 1 ? '' : 's'}`, variant: 'success' })
      clearFile()
      onOpenChange(false)
    },
  })
  const reset = () => {
    clearFile()
    importMutation.reset()
  }

  const handleFile = async (file: File | undefined) => {
    setTable(null)
    setFileError(null)
    importMutation.reset()
    if (!file) return
    setFileName(file.name)
    if (file.size > MAX_FILE_BYTES) {
      setFileError('This file is larger than 2 MB. Split it into smaller files.')
      return
    }
    try {
      setTable(parseCsv(await file.text()))
    } catch {
      setFileError('This file could not be read. Save it as CSV (UTF-8) and try again.')
    }
  }

  const invalidRows = preview?.rows.filter((row) => row.errors.length) ?? []
  const validRows = preview?.rows.filter((row) => row.payload) ?? []

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset()
        onOpenChange(next)
      }}
    >
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Import employees from CSV</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <p className="text-body-sm text-muted-foreground">
            One row per employee. Required columns: {REQUIRED_COLUMNS.join(', ')}. Optional: phone, employee_code,
            employment_type, department, designation, shift, hire_date (YYYY-MM-DD or DD/MM/YYYY). Missing
            departments and designations are created; shifts must already exist.
          </p>

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" className="gap-2" onClick={() => inputRef.current?.click()}>
              <FileUp className="h-4 w-4" />
              {fileName ? 'Choose another file' : 'Choose CSV file'}
            </Button>
            <Button
              variant="ghost"
              className="gap-2"
              onClick={() => downloadCsv('crewtraxa-employee-import-template.csv', [...IMPORT_COLUMNS], IMPORT_TEMPLATE_ROWS)}
            >
              <Download className="h-4 w-4" />
              Download template
            </Button>
            {fileName && <span className="truncate font-label text-label-md text-muted-foreground">{fileName}</span>}
            <input
              ref={inputRef}
              type="file"
              accept=".csv,text/csv"
              className="sr-only"
              aria-label="CSV file"
              onChange={(event) => void handleFile(event.target.files?.[0])}
            />
          </div>

          {fileError && (
            <Alert variant="destructive">
              <AlertDescription>{fileError}</AlertDescription>
            </Alert>
          )}
          {preview?.headerErrors.map((message) => (
            <Alert key={message} variant="destructive">
              <AlertDescription>{message}</AlertDescription>
            </Alert>
          ))}
          {importMutation.error && (
            <Alert variant="destructive">
              <AlertDescription>
                No employees were imported. {importMutation.error instanceof Error ? importMutation.error.message : 'The import failed.'}
              </AlertDescription>
            </Alert>
          )}

          {preview && preview.headerErrors.length === 0 && (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <Badge variant="success" dot>{validRows.length} ready to import</Badge>
                {invalidRows.length > 0 && <Badge variant="destructive" dot>{invalidRows.length} with problems</Badge>}
                {preview.ignoredColumns.length > 0 && (
                  <Badge variant="secondary">Ignored columns: {preview.ignoredColumns.join(', ')}</Badge>
                )}
              </div>

              {(preview.newDepartments.length > 0 || preview.newDesignations.length > 0) && (
                <div className="rounded-lg border border-border bg-muted/40 p-3 text-body-sm">
                  <p className="font-medium text-foreground">These will be created with the import:</p>
                  {preview.newDepartments.length > 0 && (
                    <p className="text-muted-foreground">Departments: {preview.newDepartments.join(', ')}</p>
                  )}
                  {preview.newDesignations.length > 0 && (
                    <p className="text-muted-foreground">Designations: {preview.newDesignations.join(', ')}</p>
                  )}
                </div>
              )}

              {invalidRows.length > 0 && (
                <div className="space-y-2">
                  <p className="flex items-center gap-2 font-label text-label-md text-foreground">
                    <AlertTriangle className="h-4 w-4 text-amber-600" />
                    Rows with problems are skipped. Fix them in the file and import it again.
                  </p>
                  <div className="scrollbar-thin max-h-56 overflow-y-auto rounded-lg border border-border">
                    <table className="w-full text-left text-body-sm">
                      <thead className="sticky top-0 bg-muted">
                        <tr>
                          <th className="px-3 py-2 font-label text-label-sm text-muted-foreground">Line</th>
                          <th className="px-3 py-2 font-label text-label-sm text-muted-foreground">Employee</th>
                          <th className="px-3 py-2 font-label text-label-sm text-muted-foreground">Problem</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {invalidRows.map((row) => (
                          <tr key={row.line}>
                            <td className="px-3 py-2 align-top tabular-nums">{row.line}</td>
                            <td className="px-3 py-2 align-top">
                              <span className="block text-foreground">{row.name || '—'}</span>
                              <span className="block text-muted-foreground">{row.email || 'no email'}</span>
                            </td>
                            <td className="px-3 py-2 align-top text-destructive">{row.errors.join(' ')}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {validRows.length > 0 && invalidRows.length === 0 && (
                <p className="flex items-center gap-2 text-body-sm text-emerald-700 dark:text-emerald-400">
                  <CheckCircle2 className="h-4 w-4" />
                  Every row is valid.
                </p>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={importMutation.isPending}>
            Cancel
          </Button>
          <Button
            onClick={() => importMutation.mutate()}
            disabled={!preview || validRows.length === 0 || importMutation.isPending}
          >
            {importMutation.isPending
              ? 'Importing…'
              : `Import ${validRows.length} employee${validRows.length === 1 ? '' : 's'}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
