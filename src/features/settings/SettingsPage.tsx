import { useMemo } from 'react'
import { useAuth } from '@/api/AuthProvider'
import { useOrganization } from '@/api/OrganizationProvider'
import { roleLabels } from '@/lib/consoleAccess'
import { OrganizationSettings } from './OrganizationSettings'
import { useTheme, type Theme } from '@/components/ThemeProvider'
import { PageHeader } from '@/components/ui/page-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { formatDateTime } from '@/lib/format'
import {
  BellRing,
  Check,
  Database,
  Globe2,
  KeyRound,
  LogOut,
  MapPinned,
  Monitor,
  Moon,
  Palette,
  RefreshCw,
  ShieldCheck,
  Sun,
} from 'lucide-react'
import { cn } from '@/lib/utils'

const themeOptions: Array<{
  value: Theme
  label: string
  description: string
  icon: typeof Sun
}> = [
  { value: 'light', label: 'Light', description: 'Bright, high-contrast console.', icon: Sun },
  { value: 'dark', label: 'Dark', description: 'Low-light operations view.', icon: Moon },
  { value: 'system', label: 'System', description: 'Follow this device setting.', icon: Monitor },
]

const alertRules = [
  {
    title: 'Geofence breach',
    severity: 'High',
    detail: 'Any recent ping recorded outside a work site geofence.',
  },
  {
    title: 'Long on-site session',
    severity: 'Medium',
    detail: 'An active attendance session longer than 10 hours.',
  },
  {
    title: 'Extended session',
    severity: 'High',
    detail: 'An active attendance session longer than 14 hours.',
  },
  {
    title: 'Missing device link',
    severity: 'Low',
    detail: 'An active employee without a linked mobile app account.',
  },
]

export function SettingsPage() {
  const { theme, resolvedTheme, setTheme } = useTheme()
  const { user, signOut } = useAuth()
  const { role } = useOrganization()
  const { toast } = useToast()

  const projectHost = useMemo(() => {
    try {
      return new URL(import.meta.env.VITE_SUPABASE_URL).host
    } catch {
      return 'Supabase project'
    }
  }, [])

  const chooseTheme = (next: Theme) => {
    setTheme(next)
    toast({
      title: `${next === 'system' ? 'System' : next === 'dark' ? 'Dark' : 'Light'} theme selected`,
      description: 'Appearance is saved on this device.',
      variant: 'info',
    })
  }

  return (
    <div className="page-shell">
      <PageHeader
        eyebrow="Administration"
        title="Settings"
        description="Appearance, account details, and the read-only configuration behind this console."
        icon={Palette}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-4">
          <OrganizationSettings />

          <section className="surface-panel p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-headline text-headline-md text-foreground">Appearance</h2>
                <p className="mt-0.5 text-body-sm text-muted-foreground">
                  Choose how Crewtraxa looks on this device.
                </p>
              </div>
              <Badge variant="outline" className="gap-1.5">
                {resolvedTheme === 'dark' ? <Moon className="h-3 w-3" /> : <Sun className="h-3 w-3" />}
                {resolvedTheme === 'dark' ? 'Dark active' : 'Light active'}
              </Badge>
            </div>
            <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
              {themeOptions.map((option) => {
                const Icon = option.icon
                const selected = theme === option.value
                return (
                  <button
                    key={option.value}
                    onClick={() => chooseTheme(option.value)}
                    className={cn(
                      'relative rounded-xl border p-3 text-left transition-all',
                      selected
                        ? 'border-primary/45 bg-primary/[0.05] shadow-sm ring-1 ring-primary/15'
                        : 'border-border/70 bg-card hover:border-primary/25 hover:bg-muted/40'
                    )}
                    aria-pressed={selected}
                  >
                    <div className="flex items-center justify-between">
                      <span
                        className={cn(
                          'flex h-8 w-8 items-center justify-center rounded-lg ring-1 ring-inset',
                          selected
                            ? 'bg-primary/10 text-primary ring-primary/15'
                            : 'bg-muted text-muted-foreground ring-border'
                        )}
                      >
                        <Icon className="h-4 w-4" />
                      </span>
                      {selected && (
                        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                          <Check className="h-3 w-3" />
                        </span>
                      )}
                    </div>
                    <p className="mt-2.5 font-label text-label-md font-semibold text-foreground">
                      {option.label}
                    </p>
                    <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                      {option.description}
                    </p>
                  </button>
                )
              })}
            </div>
            <p className="mt-3 text-[11px] text-muted-foreground">
              Theme is stored locally under <span className="font-mono">crewtraxa-theme</span> and does
              not change workspace data for other users.
            </p>
          </section>

          <section className="surface-panel p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-headline text-headline-md text-foreground">Account</h2>
                <p className="mt-0.5 text-body-sm text-muted-foreground">
                  Your signed-in console identity from Supabase Auth.
                </p>
              </div>
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary ring-1 ring-inset ring-primary/15">
                <KeyRound className="h-4 w-4" />
              </span>
            </div>
            <dl className="mt-4 divide-y divide-border/60 rounded-lg border border-border/70">
              <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                <dt className="text-body-sm text-muted-foreground">Email</dt>
                <dd className="max-w-[220px] truncate font-label text-label-md text-foreground">
                  {user?.email ?? '—'}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                <dt className="text-body-sm text-muted-foreground">Console role</dt>
                <dd>
                  <Badge variant="success" dot>
                    {role ? roleLabels[role] : 'Unknown'}
                  </Badge>
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                <dt className="text-body-sm text-muted-foreground">Last sign in</dt>
                <dd className="text-[11px] text-foreground">
                  {formatDateTime(user?.last_sign_in_at)}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                <dt className="text-body-sm text-muted-foreground">User ID</dt>
                <dd className="max-w-[220px] truncate font-mono text-[10px] text-foreground">
                  {user?.id ?? '—'}
                </dd>
              </div>
            </dl>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
                An organization role is required to open this console.
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={async () => {
                  await signOut()
                }}
                className="gap-2 text-destructive hover:text-destructive"
              >
                <LogOut className="h-3.5 w-3.5" />
                Sign out
              </Button>
            </div>
          </section>

          <section className="surface-panel p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-headline text-headline-md text-foreground">Alert rules</h2>
                <p className="mt-0.5 text-body-sm text-muted-foreground">
                  Thresholds used to derive the Alerts queue. These are read-only in the console.
                </p>
              </div>
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-500/10 text-amber-600 ring-1 ring-inset ring-amber-500/15 dark:text-amber-400">
                <BellRing className="h-4 w-4" />
              </span>
            </div>
            <ul className="mt-4 divide-y divide-border/60 rounded-lg border border-border/70">
              {alertRules.map((rule) => (
                <li key={rule.title} className="flex items-start gap-3 px-3.5 py-3">
                  <span
                    className={cn(
                      'mt-1 h-1.5 w-1.5 shrink-0 rounded-full',
                      rule.severity === 'High'
                        ? 'bg-red-500'
                        : rule.severity === 'Medium'
                          ? 'bg-amber-500'
                          : 'bg-slate-400'
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-label text-label-md font-medium text-foreground">
                        {rule.title}
                      </p>
                      <Badge
                        variant={
                          rule.severity === 'High'
                            ? 'destructive'
                            : rule.severity === 'Medium'
                              ? 'warning'
                              : 'secondary'
                        }
                      >
                        {rule.severity}
                      </Badge>
                    </div>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">{rule.detail}</p>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        </div>

        <aside className="space-y-4">
          <section className="surface-panel p-4">
            <h2 className="font-headline text-headline-md text-foreground">Workspace</h2>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Read-only runtime details for this deployment.
            </p>
            <dl className="mt-3 space-y-3">
              <div>
                <dt className="font-label text-[10px] uppercase tracking-wider text-muted-foreground">
                  Console
                </dt>
                <dd className="mt-0.5 flex items-center justify-between gap-2 text-body-sm text-foreground">
                  Crewtraxa Workforce
                  <Badge variant="success" dot>
                    Connected
                  </Badge>
                </dd>
              </div>
              <div>
                <dt className="font-label text-[10px] uppercase tracking-wider text-muted-foreground">
                  Data source
                </dt>
                <dd className="mt-0.5 flex items-center gap-1.5 text-body-sm text-foreground">
                  <Database className="h-3.5 w-3.5 text-primary" />
                  <span className="truncate font-mono text-[11px]">{projectHost}</span>
                </dd>
              </div>
              <div>
                <dt className="font-label text-[10px] uppercase tracking-wider text-muted-foreground">
                  Basemap
                </dt>
                <dd className="mt-0.5 flex items-center gap-1.5 text-body-sm text-foreground">
                  <Globe2 className="h-3.5 w-3.5 text-primary" />
                  OpenStreetMap raster tiles
                </dd>
                <p className="mt-1 text-[10px] text-muted-foreground">
                  No API key required. Tile attribution appears on every map.
                </p>
              </div>
              <div>
                <dt className="font-label text-[10px] uppercase tracking-wider text-muted-foreground">
                  Geofence model
                </dt>
                <dd className="mt-0.5 flex items-center gap-1.5 text-body-sm text-foreground">
                  <MapPinned className="h-3.5 w-3.5 text-primary" />
                  Center point + radius
                </dd>
                <p className="mt-1 text-[10px] text-muted-foreground">
                  Polygon drawing is a preview that converts to a circle before saving.
                </p>
              </div>
            </dl>
          </section>

          <section className="surface-panel p-4">
            <h2 className="font-headline text-headline-md text-foreground">Data refresh</h2>
            <div className="mt-2 space-y-2 text-[11px] text-muted-foreground">
              <p className="flex items-start gap-2">
                <RefreshCw className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                Opening a navigation item refetches that page&apos;s data from Supabase.
              </p>
              <p className="flex items-start gap-2">
                <BellRing className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                Live Tracking shows a snapshot with a manual refresh control; it does not maintain a
                realtime subscription.
              </p>
              <p className="flex items-start gap-2">
                <Database className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                Alerts and reports are computed from existing location and attendance records.
              </p>
            </div>
          </section>

          <section className="surface-panel p-4">
            <h2 className="font-headline text-headline-md text-foreground">Reset appearance</h2>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Return this device to the bright console theme. Your account and data are not affected.
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => chooseTheme('light')}
              className="mt-3 w-full gap-2"
            >
              <Sun className="h-3.5 w-3.5" />
              Use light theme
            </Button>
          </section>
        </aside>
      </div>
    </div>
  )
}
