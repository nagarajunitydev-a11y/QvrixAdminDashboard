import * as React from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"

export type ColumnDef<T> = {
  header: string
  accessor: keyof T | ((row: T) => React.ReactNode)
  className?: string
}

export interface DataTableProps<TData> {
  columns: ColumnDef<TData>[]
  data: TData[]
  pageSize?: number
  emptyMessage?: string
  emptyState?: React.ReactNode
}

function pageWindow(current: number, total: number) {
  if (total <= 5) return Array.from({ length: total }, (_, i) => i)
  const start = Math.max(0, Math.min(current - 2, total - 5))
  return Array.from({ length: 5 }, (_, i) => start + i)
}

export function DataTable<TData extends object>({
  columns,
  data,
  pageSize = 10,
  emptyMessage = "No records found",
  emptyState,
}: DataTableProps<TData>) {
  const [rawPageIndex, setPageIndex] = React.useState(0)
  const pageCount = Math.max(1, Math.ceil(data.length / pageSize))
  const pageIndex = Math.min(rawPageIndex, pageCount - 1)

  const start = pageIndex * pageSize
  const end = Math.min(start + pageSize, data.length)
  const pageData = data.slice(start, end)

  if (emptyState && data.length === 0) return <>{emptyState}</>

  return (
    <div className="flex flex-col">
      <div className="scrollbar-thin overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-left">
          <thead>
            <tr className="border-b border-border bg-muted/60">
              {columns.map((column, i) => (
                <th
                  key={i}
                  scope="col"
                  className={cn(
                    "whitespace-nowrap px-4 py-3 font-label text-label-sm font-semibold uppercase tracking-[0.08em] text-muted-foreground",
                    column.className
                  )}
                >
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/80 font-body text-body-sm">
            {pageData.map((row, i) => (
              <tr key={start + i} className="row-hover">
                {columns.map((column, j) => (
                  <td key={j} className={cn("px-4 py-3 align-middle", column.className)}>
                    {typeof column.accessor === 'function'
                      ? column.accessor(row)
                      : String(row[column.accessor as keyof TData] ?? '')}
                  </td>
                ))}
              </tr>
            ))}
            {pageData.length === 0 && (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-4 py-12 text-center text-body-sm text-muted-foreground"
                >
                  {emptyMessage}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="flex flex-col gap-3 border-t border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <span className="text-body-sm text-muted-foreground">
          Showing {data.length === 0 ? 0 : start + 1}&ndash;{end} of {data.length}
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setPageIndex(Math.max(0, pageIndex - 1))}
            disabled={pageIndex === 0}
            className="flex h-8 items-center gap-1 rounded-md border border-input bg-card px-2.5 text-label-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
            aria-label="Previous page"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Previous</span>
          </button>
          {pageWindow(pageIndex, pageCount).map((p) => (
            <button
              key={p}
              onClick={() => setPageIndex(p)}
              aria-current={pageIndex === p ? 'page' : undefined}
              className={cn(
                "h-8 min-w-8 rounded-md px-2 text-label-md transition-colors",
                pageIndex === p
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "border border-input bg-card text-foreground hover:bg-muted"
              )}
            >
              {p + 1}
            </button>
          ))}
          <button
            onClick={() => setPageIndex(Math.min(pageCount - 1, pageIndex + 1))}
            disabled={pageIndex >= pageCount - 1}
            className="flex h-8 items-center gap-1 rounded-md border border-input bg-card px-2.5 text-label-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
            aria-label="Next page"
          >
            <span className="hidden sm:inline">Next</span>
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  )
}
