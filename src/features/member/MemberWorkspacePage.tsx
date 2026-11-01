import { useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, ArrowRight, Clock3, Download, RefreshCw } from 'lucide-react'
import { useAuth } from '@/api/AuthProvider'
import { useOrganization } from '@/api/OrganizationProvider'
import { clockOnWeb, fetchMyEntries, fetchMyOpenSession, fetchMySites, fetchMyTimesheet, keepMyShiftActive } from '@/api/member'
import type { MemberProfile } from '@/lib/consoleAccess'
import { clockIn, hm, periodLabel, periodRange, shiftPeriod, totalsFor, zonedParts } from '@/lib/timesheets'
import { downloadCsv } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { ErrorState, InlineSpinner } from '@/components/ui/states'
import { Label } from '@/components/ui/label'

export function MemberWorkspacePage() {
  const { member } = useOrganization()
  const { user } = useAuth()
  if (!member || !user) return <Navigate to="/account" replace />
  return <PersonalWorkspace key={member.id} member={member} userId={user.id} />
}

function PersonalWorkspace({ member, userId }: { member: MemberProfile; userId: string }) {
  const client = useQueryClient()
  const { user, signOut } = useAuth()
  const timezone = member.organizations.timezone
  const [anchor, setAnchor] = useState(() => zonedParts(new Date(), timezone).date)
  const [siteId, setSiteId] = useState('')
  const [accountError, setAccountError] = useState<string | null>(null)
  const [signingOut, setSigningOut] = useState(false)
  const range = periodRange('week', anchor)
  const key = ['member', userId]
  const sites = useQuery({ queryKey: [...key, 'sites'], queryFn: () => fetchMySites(member.id) })
  const session = useQuery({ queryKey: [...key, 'session'], queryFn: () => fetchMyOpenSession(userId), refetchInterval: 60_000, refetchOnWindowFocus: true })
  const heartbeat = useQuery({ queryKey: [...key, 'heartbeat', session.data?.id], queryFn: keepMyShiftActive,
    enabled: Boolean(session.data?.id), refetchInterval: 60_000, refetchOnWindowFocus: true, retry: false })
  const days = useQuery({ queryKey: [...key, 'timesheet', range.from], queryFn: () => fetchMyTimesheet(range.from, range.to) })
  const entries = useQuery({ queryKey: [...key, 'entries', range.from], queryFn: () => fetchMyEntries(range.from, range.to) })
  const chosenSite = siteId || sites.data?.[0]?.id || ''
  const clock = useMutation({
    mutationFn: () => clockOnWeb(session.data ? 'out' : 'in', chosenSite),
    onSuccess: () => client.invalidateQueries({ queryKey: key }),
  })
  const totals = totalsFor(days.data ?? [])
  const leave = async () => {
    setSigningOut(true)
    setAccountError(null)
    try { await signOut() } catch (error) { setAccountError(error instanceof Error ? error.message : 'Could not sign out. Try again.') }
    finally { setSigningOut(false) }
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card px-4 py-4 sm:px-8">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3">
          <Link to="/account" className="flex items-center gap-2 rounded-sm font-headline text-lg font-bold focus-visible:ring-2 focus-visible:ring-ring">
            <img src="/crewtraxa-pin.png" alt="" className="h-8 w-8 object-contain" /> Crewtraxa
          </Link>
          <nav className="flex items-center gap-2" aria-label="Account navigation">
            <Button asChild variant="ghost"><Link to="/account">My account</Link></Button>
            <Button variant="outline" disabled={signingOut} onClick={() => void leave()}>{signingOut ? 'Signing out…' : 'Sign out'}</Button>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-5xl space-y-8 px-4 py-8 sm:px-8">
        <div>
          <h1 className="font-headline text-headline-lg text-foreground">My workspace</h1>
          <p className="mt-1 text-body-md text-muted-foreground">{member.first_name} {member.last_name} · {member.organizations.name}</p>
          <p className="mt-1 break-all text-body-sm text-muted-foreground">{user?.email} · Member</p>
        </div>
        {accountError && <Alert variant="destructive"><AlertDescription>{accountError}</AlertDescription></Alert>}
        <section className="rounded-xl border border-border bg-card p-5 sm:p-6" aria-labelledby="time-clock-title">
          <div className="flex flex-wrap items-start justify-between gap-5">
            <div>
              <h2 id="time-clock-title" className="flex items-center gap-2 font-headline text-headline-md"><Clock3 className="h-5 w-5 text-primary" aria-hidden /> Time clock</h2>
              <p className="mt-2 text-body-md text-muted-foreground" role="status">{session.isPending ? 'Checking your shift…' : session.error ? 'Shift status unavailable' : session.data ? `Clocked in at ${clockIn(new Date(session.data.entry_timestamp).toISOString(), timezone)}` : 'You are clocked out'}</p>
              <p className="mt-1 text-body-sm text-muted-foreground">Times shown in {timezone.replace(/_/g, ' ')}.</p>
            </div>
            <div className="flex w-full flex-col gap-3 sm:w-auto sm:min-w-64">
              {!session.data && (
                <div className="space-y-1.5">
                  <Label htmlFor="my-site">Work site</Label>
                  <select id="my-site" value={chosenSite} onChange={event => setSiteId(event.target.value)} disabled={sites.isPending || clock.isPending}
                    className="h-11 w-full rounded-md border border-input bg-background px-3 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    {!sites.data?.length && <option value="">No assigned sites</option>}
                    {sites.data?.map(site => <option key={site.id} value={site.id}>{site.name}</option>)}
                  </select>
                </div>
              )}
              <Button className="h-11" disabled={clock.isPending || session.isPending || Boolean(session.error) || (!session.data && !chosenSite)} onClick={() => clock.mutate()}>
                {clock.isPending ? 'Recording attendance…' : session.data ? 'Clock out' : 'Clock in'}
              </Button>
            </div>
          </div>
          {!sites.isPending && !sites.error && !sites.data?.length && !session.data && <p className="mt-4 text-body-sm text-muted-foreground">Ask your manager to assign a work site before checking in.</p>}
          {(session.error || sites.error || clock.error || heartbeat.error) && <Alert variant="destructive" className="mt-4"><AlertDescription>{(clock.error || session.error || sites.error || heartbeat.error)?.message}</AlertDescription></Alert>}
          <p className="mt-4 text-body-sm text-muted-foreground">Clock-in uses your current location and your team's attendance rules. Device-locked teams check in through their registered Employee app.</p>
          {session.data && <p className="mt-2 text-body-sm text-muted-foreground">Keep this page open while working so your shift stays active. Use the Employee app for background or offline tracking.</p>}
        </section>
        <section aria-labelledby="my-timesheet-title">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="my-timesheet-title" className="font-headline text-headline-md">My timesheet</h2>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => void client.invalidateQueries({ queryKey: key })}><RefreshCw className="mr-2 h-4 w-4" />Refresh</Button>
              <Button variant="outline" size="sm" disabled={!days.data?.length} onClick={() => downloadCsv(`my-timesheet-${range.from}.csv`, ['Date', 'First in', 'Last out', 'Tracked minutes', 'Break minutes', 'Payroll minutes'],
                (days.data ?? []).map(day => [day.work_date, day.first_in, day.last_out, day.tracked_minutes, day.break_minutes, day.payroll_minutes]))}><Download className="mr-2 h-4 w-4" />Export</Button>
            </div>
          </div>
          <div className="my-4 flex flex-wrap items-center gap-2">
            <Button variant="outline" size="icon" aria-label="Previous week" onClick={() => setAnchor(shiftPeriod('week', range.from, -1))}><ArrowLeft className="h-4 w-4" /></Button>
            <p className="text-body-sm font-medium">{periodLabel('week', range.from, range.to)}</p>
            <Button variant="outline" size="icon" aria-label="Next week" onClick={() => setAnchor(shiftPeriod('week', range.from, 1))}><ArrowRight className="h-4 w-4" /></Button>
          </div>
          {days.isPending ? <InlineSpinner /> : days.error ? <ErrorState description={days.error.message} onRetry={() => void days.refetch()} /> : (
            <>
              <p className="mb-4 text-body-md text-muted-foreground">Tracked {hm(totals.tracked)} · Breaks {hm(totals.breaks)} · Payroll {hm(totals.payroll)}</p>
              <div className="overflow-x-auto rounded-xl border border-border bg-card">
                <table className="w-full text-left text-body-sm">
                  <caption className="sr-only">Your personal timesheet for {range.from} to {range.to}</caption>
                  <thead className="border-b border-border bg-muted/50"><tr>{['Date', 'First in', 'Last out', 'Tracked', 'Payroll'].map(label => <th key={label} scope="col" className="whitespace-nowrap px-4 py-3 font-semibold">{label}</th>)}</tr></thead>
                  <tbody className="divide-y divide-border">
                    {days.data?.map(day => <tr key={day.work_date}><th scope="row" className="whitespace-nowrap px-4 py-3 font-medium">{day.work_date}</th><td className="whitespace-nowrap px-4 py-3">{clockIn(day.first_in, timezone)}</td><td className="whitespace-nowrap px-4 py-3">{clockIn(day.last_out, timezone)}</td><td className="px-4 py-3">{hm(day.tracked_minutes)}</td><td className="px-4 py-3">{hm(day.payroll_minutes)}</td></tr>)}
                    {!days.data?.length && <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">No attendance records for this week.</td></tr>}
                  </tbody>
                </table>
              </div>
            </>
          )}
          <details className="mt-5 text-body-sm">
            <summary className="cursor-pointer rounded-sm font-medium focus-visible:ring-2 focus-visible:ring-ring">View my time entries</summary>
            {entries.isPending ? <InlineSpinner /> : entries.error ? <ErrorState description={entries.error.message} onRetry={() => void entries.refetch()} /> : (
              <ul className="mt-3 divide-y divide-border">{entries.data?.map((entry, index) => <li key={`${entry.session_id}-${entry.correction_id}-${index}`} className="py-3">{entry.work_date} · {clockIn(entry.start_at, timezone)} – {entry.end_at ? clockIn(entry.end_at, timezone) : 'In progress'} · {entry.status}</li>)}
                {!entries.data?.length && <li className="py-3 text-muted-foreground">No time entries in this week.</li>}
              </ul>
            )}
          </details>
        </section>
      </main>
    </div>
  )
}
