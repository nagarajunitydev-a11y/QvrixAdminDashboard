import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchEmployeeSites, type EmployeeWithRelations } from './services'
import { fetchWorkforceSnapshot } from './workforceTracking'
import { deriveWorkforceCounts } from '../lib/workforce'
import type { Site } from '../types'

export function useWorkforceTracking(employees: EmployeeWithRelations[], sites: Site[], enabled: boolean) {
  const [now, setNow] = useState(Date.now)
  const userIds = [...new Set(employees.flatMap((employee) => employee.user_id ? [employee.user_id] : []))].sort()
  const snapshotQuery = useQuery({
    queryKey: ['workforce-tracking', userIds],
    queryFn: () => fetchWorkforceSnapshot(userIds),
    enabled,
    refetchInterval: 15_000,
  })
  const assignmentsQuery = useQuery({
    queryKey: ['employee-sites'],
    queryFn: () => fetchEmployeeSites(),
    enabled,
    refetchInterval: 15_000,
  })
  useEffect(() => {
    // React Query preserves equal data by reference. Advance time even when
    // an offline device sends nothing, so its last fix can expire on screen.
    const interval = window.setInterval(() => setNow(Date.now()), 15_000)
    return () => window.clearInterval(interval)
  }, [])
  const counts = useMemo(() => deriveWorkforceCounts(
    employees, snapshotQuery.data?.sessions ?? [], snapshotQuery.data?.locations ?? [],
    sites, assignmentsQuery.data ?? [], Math.max(now, snapshotQuery.dataUpdatedAt),
  ), [employees, sites, snapshotQuery.data, snapshotQuery.dataUpdatedAt, assignmentsQuery.data, now])

  return { counts, snapshotQuery, assignmentsQuery, now: Math.max(now, snapshotQuery.dataUpdatedAt) }
}
