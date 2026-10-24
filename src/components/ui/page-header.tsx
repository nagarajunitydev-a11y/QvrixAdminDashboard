import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  icon,
  className,
}: {
  eyebrow?: string
  title: string
  description?: string
  actions?: ReactNode
  icon?: LucideIcon | (() => ReactNode)
  className?: string
}) {
  const IconComponent = typeof icon === 'function' && (icon as any).length === 0 ? null : (icon as LucideIcon)
  const isCustom = typeof icon === 'function' && !IconComponent
  return (
    <div
      className={cn(
        'flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between',
        className
      )}
    >
      <div className="flex items-start gap-3">
        {isCustom ? (
          <span className="mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 ring-1 ring-inset ring-primary/15">
            {(icon as () => ReactNode)()}
          </span>
        ) : IconComponent ? (
          <span className="mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-inset ring-primary/15">
            <IconComponent className="h-5 w-5" />
          </span>
        ) : null}
        <div>
          {eyebrow && (
            <p className="mb-1 font-label text-label-sm uppercase tracking-[0.16em] text-primary">
              {eyebrow}
            </p>
          )}
          <h1 className="font-headline text-headline-lg text-foreground">{title}</h1>
          {description && (
            <p className="mt-1 max-w-2xl text-body-sm text-muted-foreground">{description}</p>
          )}
        </div>
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}
