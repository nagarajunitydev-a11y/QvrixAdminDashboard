import * as React from "react"

export type ColumnDef<T> = {
  header: string
  accessor: keyof T | ((row: T) => React.ReactNode)
  className?: string
}

export interface DataTableProps<TData> {
  columns: ColumnDef<TData>[]
  data: TData[]
  pageSize?: number
}

export function DataTable<TData extends object>({
  columns,
  data,
  pageSize = 10,
}: DataTableProps<TData>) {
  const [rawPageIndex, setPageIndex] = React.useState(0)
  const pageCount = Math.max(1, Math.ceil(data.length / pageSize))
  const pageIndex = Math.min(rawPageIndex, pageCount - 1)

  const start = pageIndex * pageSize
  const end = Math.min(start + pageSize, data.length)
  const pageData = data.slice(start, end)

  return (
    <div className="flex flex-col">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-border bg-muted">
              {columns.map((column, i) => (
                <th
                  key={i}
                  className={`whitespace-nowrap px-4 py-3 font-label text-label-sm font-semibold uppercase tracking-wider text-muted-foreground ${
                    column.className ?? ""
                  }`}
                >
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="font-body text-body-sm divide-y divide-border">
            {pageData.map((row, i) => (
              <tr key={start + i} className="row-hover transition-colors">
                {columns.map((column, j) => (
                  <td key={j} className={`px-4 py-3 align-middle ${column.className ?? ""}`}>
                    {typeof column.accessor === 'function'
                      ? column.accessor(row)
                      : String(row[column.accessor as keyof TData] ?? '')}
                  </td>
                ))}
              </tr>
            ))}
            {pageData.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="px-4 py-10 text-center text-body-sm text-muted-foreground">
                  No records found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="flex flex-col gap-3 border-t border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <span className="text-body-sm text-muted-foreground">
          Showing {data.length === 0 ? 0 : start + 1} to {end} of {data.length} entries
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setPageIndex(Math.max(0, pageIndex - 1))}
            disabled={pageIndex === 0}
            className="rounded-md border border-input bg-card px-3 py-1.5 text-label-md text-muted-foreground transition-colors hover:bg-muted disabled:opacity-50"
          >
            Previous
          </button>
          {Array.from({ length: pageCount }).slice(0, 5).map((_, p) => (
            <button
              key={p}
              onClick={() => setPageIndex(p)}
              className={`h-8 min-w-8 rounded-md px-2 py-1.5 text-label-md transition-colors ${
                pageIndex === p
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "border border-input bg-card text-foreground hover:bg-muted"
              }`}
            >
              {p + 1}
            </button>
          ))}
          {pageCount > 5 && <span className="px-1 text-muted-foreground">…</span>}
          <button
            onClick={() => setPageIndex(Math.min(pageCount - 1, pageIndex + 1))}
            disabled={pageIndex >= pageCount - 1}
            className="rounded-md border border-input bg-card px-3 py-1.5 text-label-md text-muted-foreground transition-colors hover:bg-muted disabled:opacity-50"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  )
}
