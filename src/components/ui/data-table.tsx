import * as React from 'react'
import {
  Search,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  ChevronLeft,
  ChevronRight,
  SlidersHorizontal,
} from 'lucide-react'
import { EmptyState } from '@/components/PageState'

export type ColumnDef<T> = {
  header: string
  accessor: keyof T | ((row: T) => React.ReactNode)
  className?: string
  sortValue?: (row: T) => string | number
}
export interface DataTableProps<TData> {
  columns: ColumnDef<TData>[]
  data: TData[]
  pageSize?: number
}

function textContent(value: React.ReactNode): string {
  if (typeof value === 'string' || typeof value === 'number')
    return String(value)
  if (Array.isArray(value)) return value.map(textContent).join(' ')
  if (React.isValidElement<{ children?: React.ReactNode }>(value))
    return textContent(value.props.children)
  return ''
}

export function DataTable<TData extends object>({
  columns,
  data,
  pageSize = 10,
}: DataTableProps<TData>) {
  const [rawPageIndex, setPageIndex] = React.useState(0)
  const [search, setSearch] = React.useState('')
  const [size, setSize] = React.useState(pageSize)
  const [sort, setSort] = React.useState<{
    index: number
    direction: 1 | -1
  } | null>(null)
  const cell = (row: TData, column: ColumnDef<TData>) =>
    typeof column.accessor === 'function'
      ? column.accessor(row)
      : String(row[column.accessor] ?? '')
  const filtered = data.filter((row) =>
    columns.some(
      (column) =>
        column.header !== 'Actions' &&
        textContent(cell(row, column))
          .toLowerCase()
          .includes(search.toLowerCase()),
    ),
  )
  if (sort) {
    const column = columns[sort.index]
    filtered.sort((a, b) => {
      const av = column.sortValue
        ? column.sortValue(a)
        : textContent(cell(a, column))
      const bv = column.sortValue
        ? column.sortValue(b)
        : textContent(cell(b, column))
      return (
        String(av).localeCompare(String(bv), undefined, {
          numeric: true,
          sensitivity: 'base',
        }) * sort.direction
      )
    })
  }
  const pageCount = Math.max(1, Math.ceil(filtered.length / size))
  const pageIndex = Math.min(rawPageIndex, pageCount - 1)
  const start = pageIndex * size
  const end = Math.min(start + size, filtered.length)
  const pageNumbers = Array.from(
    { length: Math.min(pageCount, 5) },
    (_, i) =>
      Math.min(Math.max(pageIndex - 2, 0), Math.max(pageCount - 5, 0)) + i,
  )
  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
        <label className="relative w-full sm:max-w-72">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <input
            type="search"
            aria-label="Search table records"
            placeholder="Search records…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              setPageIndex(0)
            }}
            className="h-9 w-full rounded-lg border bg-background/70 pl-9 pr-3 text-xs placeholder:text-muted-foreground"
          />
        </label>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <SlidersHorizontal className="h-3.5 w-3.5" />
          <span>{filtered.length} records</span>
          <span className="mx-1 text-border">/</span>
          <label className="flex items-center gap-2">
            Rows
            <select
              aria-label="Rows per page"
              value={size}
              onChange={(e) => {
                setSize(Number(e.target.value))
                setPageIndex(0)
              }}
              className="rounded-md border bg-card p-1 text-foreground"
            >
              {Array.from(new Set([pageSize, 10, 25, 50]))
                .sort((a, b) => a - b)
                .map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
            </select>
          </label>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b bg-muted/60">
              {columns.map((column, i) => (
                <th
                  key={i}
                  aria-sort={
                    sort?.index === i
                      ? sort.direction === 1
                        ? 'ascending'
                        : 'descending'
                      : undefined
                  }
                  className={`whitespace-nowrap px-5 py-3 text-[10px] font-medium uppercase tracking-wider text-muted-foreground ${column.className || ''}`}
                >
                  {column.header === 'Actions' ? (
                    column.header
                  ) : (
                    <button
                      className="inline-flex items-center gap-2"
                      onClick={() => {
                        setSort({
                          index: i,
                          direction:
                            sort?.index === i && sort.direction === 1 ? -1 : 1,
                        })
                        setPageIndex(0)
                      }}
                    >
                      {column.header}
                      {sort?.index === i ? (
                        sort.direction === 1 ? (
                          <ArrowUp className="h-3 w-3 text-primary" />
                        ) : (
                          <ArrowDown className="h-3 w-3 text-primary" />
                        )
                      ) : (
                        <ArrowUpDown className="h-3 w-3 opacity-40" />
                      )}
                    </button>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y text-[13px]">
            {filtered.slice(start, end).map((row, i) => (
              <tr
                key={String((row as { id?: string | number }).id ?? start + i)}
                className="row-hover"
              >
                {columns.map((column, j) => (
                  <td
                    key={j}
                    className={`px-5 py-4 align-middle ${column.className || ''}`}
                  >
                    {cell(row, column)}
                  </td>
                ))}
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={columns.length}>
                  <EmptyState
                    title={search ? 'No matching records' : 'No records yet'}
                    description={
                      search
                        ? 'Try a different search or clear your filters.'
                        : 'New records will appear here once they are available.'
                    }
                  />
                  {search && (
                    <button
                      className="mx-auto mb-5 block text-xs text-primary underline"
                      onClick={() => setSearch('')}
                    >
                      Clear search
                    </button>
                  )}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t px-5 py-3">
        <span className="text-xs text-muted-foreground">
          Showing{' '}
          <span className="font-medium text-foreground">
            {filtered.length ? start + 1 : 0}–{end}
          </span>{' '}
          of {filtered.length}
        </span>
        <div className="flex items-center gap-1">
          <button
            aria-label="Previous page"
            onClick={() => setPageIndex(Math.max(0, pageIndex - 1))}
            disabled={pageIndex === 0}
            className="icon-button h-8 w-8 disabled:opacity-30"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          {pageNumbers.map((p) => (
            <button
              key={p}
              aria-label={`Page ${p + 1}`}
              aria-current={pageIndex === p ? 'page' : undefined}
              onClick={() => setPageIndex(p)}
              className={`h-8 min-w-8 rounded-md px-2 text-xs transition ${pageIndex === p ? 'bg-primary/10 font-semibold text-primary' : 'text-muted-foreground hover:bg-muted'}`}
            >
              {p + 1}
            </button>
          ))}
          <button
            aria-label="Next page"
            onClick={() => setPageIndex(Math.min(pageCount - 1, pageIndex + 1))}
            disabled={pageIndex >= pageCount - 1}
            className="icon-button h-8 w-8 disabled:opacity-30"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  )
}
