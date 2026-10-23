import { Inbox, TriangleAlert, RefreshCw } from 'lucide-react'
import { Button } from './ui/button'

export function EmptyState({
  title = 'Nothing here just yet',
  description = 'Records will appear here when activity is available.',
}: {
  title?: string
  description?: string
}) {
  return (
    <div className="flex min-h-48 flex-col items-center justify-center px-6 py-10 text-center">
      <div className="mb-4 rounded-2xl border bg-muted/60 p-3">
        <Inbox className="h-6 w-6 text-muted-foreground" />
      </div>
      <h3 className="font-medium">{title}</h3>
      <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">
        {description}
      </p>
    </div>
  )
}

export function PageSkeleton() {
  return (
    <div role="status" aria-label="Loading page" className="space-y-6">
      <div className="skeleton h-9 w-56" />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[0, 1, 2, 3].map((n) => (
          <div key={n} className="skeleton h-32" />
        ))}
      </div>
      <div className="skeleton h-80" />
      <span className="sr-only">Loading data…</span>
    </div>
  )
}

export function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div
      role="alert"
      className="mb-6 flex flex-wrap items-center gap-3 rounded-xl border border-destructive/20 bg-destructive/5 p-4"
    >
      <TriangleAlert className="h-5 w-5 text-destructive" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">Some data couldn’t be loaded</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Check your connection and access, then try again. Previously loaded
          data may still be shown.
        </p>
      </div>
      <Button variant="outline" onClick={onRetry}>
        <RefreshCw className="h-3.5 w-3.5" />
        Try again
      </Button>
    </div>
  )
}
