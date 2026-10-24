import type { LucideIcon } from 'lucide-react'
import { ArrowDownRight, ArrowUpRight } from 'lucide-react'
import { cn } from '@/lib/utils'

type Tone = 'teal' | 'sky' | 'emerald' | 'amber' | 'red' | 'slate'

const toneStyles: Record<Tone, { icon: string; line: string }> = {
  teal: { icon: 'bg-primary/10 text-primary ring-primary/15', line: 'sparkline-green' },
  sky: { icon: 'bg-sky-500/10 text-sky-600 ring-sky-500/15 dark:text-sky-400', line: 'sparkline-blue' },
  emerald: { icon: 'bg-emerald-500/10 text-emerald-600 ring-emerald-500/15 dark:text-emerald-400', line: 'sparkline-green' },
  amber: { icon: 'bg-amber-500/10 text-amber-600 ring-amber-500/15 dark:text-amber-400', line: 'sparkline-amber' },
  red: { icon: 'bg-red-500/10 text-red-600 ring-red-500/15 dark:text-red-400', line: 'sparkline-red' },
  slate: { icon: 'bg-muted text-muted-foreground ring-border', line: 'sparkline-blue' },
}

export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = 'teal',
  trend,
  trendLabel,
  footer,
  className,
}: {
  label: string
  value: string | number
  hint?: string
  icon: LucideIcon
  tone?: Tone
  trend?: 'up' | 'down'
  trendLabel?: string
  footer?: React.ReactNode
  className?: string
}) {
  const styles = toneStyles[tone]

  return (
    <div className={cn('card-kpi group', className)}>
      <div className="relative z-10 mb-3 flex items-start justify-between gap-3">
        <span className="font-label text-label-md text-muted-foreground">{label}</span>
        <span
          className={cn(
            'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset',
            styles.icon
          )}
        >
          <Icon className="h-4 w-4" />
        </span>
      </div>
      <div className="relative z-10 flex items-end gap-2">
        <span className="font-headline text-[30px] font-bold leading-none tracking-tight text-foreground">
          {value}
        </span>
        {trend && trendLabel && (
          <span
            className={cn(
              'mb-0.5 inline-flex items-center gap-0.5 font-label text-label-sm',
              trend === 'up' ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
            )}
          >
            {trend === 'up' ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
            {trendLabel}
          </span>
        )}
      </div>
      {(hint || footer) && (
        <div className="relative z-10 mt-2.5 text-body-sm text-muted-foreground">
          {footer ?? hint}
        </div>
      )}
      <div className={cn('sparkline', styles.line)} />
    </div>
  )
}
