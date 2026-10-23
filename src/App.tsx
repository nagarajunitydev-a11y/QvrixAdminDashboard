import { lazy, Suspense } from 'react'
import { PageSkeleton } from './components/PageState'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from './api/AuthProvider'
import { queryClient } from './api/queryClient'
import { ProtectedRoute } from './auth/ProtectedRoute'
import { ManagerLayout } from './components/ManagerLayout'
import { LoginPage } from './components/LoginPage'
import { ConfirmProvider } from './components/ConfirmProvider'
import { OrganizationBoundary } from './components/OrganizationProvider'
const OrganizationsPage = lazy(() =>
  import('./features/organizations/OrganizationsPage').then((module) => ({
    default: module.OrganizationsPage,
  })),
)
const OrganizationUsersPage = lazy(() =>
  import('./features/organizations/OrganizationUsersPage').then((module) => ({
    default: module.OrganizationUsersPage,
  })),
)
const OrganizationSettingsPage = lazy(() =>
  import('./features/organizations/OrganizationUsersPage').then((module) => ({
    default: module.OrganizationSettingsPage,
  })),
)
const AcceptInvitationPage = lazy(() =>
  import('./features/organizations/OrganizationUsersPage').then((module) => ({
    default: module.AcceptInvitationPage,
  })),
)

// Lazy-loaded feature pages
const DashboardPage = lazy(() =>
  import('./features/dashboard/DashboardPage').then((module) => ({
    default: module.DashboardPage,
  })),
)
const EmployeesPage = lazy(() =>
  import('./features/employees/EmployeesPage').then((module) => ({
    default: module.EmployeesPage,
  })),
)
const DepartmentsPage = lazy(() =>
  import('./features/departments/DepartmentsPage').then((module) => ({
    default: module.DepartmentsPage,
  })),
)
const DesignationsPage = lazy(() =>
  import('./features/designations/DesignationsPage').then((module) => ({
    default: module.DesignationsPage,
  })),
)
const ShiftsPage = lazy(() =>
  import('./features/shifts/ShiftsPage').then((module) => ({
    default: module.ShiftsPage,
  })),
)
const SitesPage = lazy(() =>
  import('./features/sites/SitesPage').then((module) => ({
    default: module.SitesPage,
  })),
)
const LocationLogsPage = lazy(() =>
  import('./features/location-logs/LocationLogsPage').then((module) => ({
    default: module.LocationLogsPage,
  })),
)
const PresenceSessionsPage = lazy(() =>
  import('./features/presence/PresenceSessionsPage').then((module) => ({
    default: module.PresenceSessionsPage,
  })),
)
const AssignmentsPage = lazy(() =>
  import('./features/employee-sites/AssignmentsPage').then((module) => ({
    default: module.AssignmentsPage,
  })),
)
const AuditLogsPage = lazy(() =>
  import('./features/audit-logs/AuditLogsPage').then((module) => ({
    default: module.AuditLogsPage,
  })),
)
const LiveTrackingPage = lazy(() =>
  import('./features/workspace/WorkspacePages').then((module) => ({
    default: module.LiveTrackingPage,
  })),
)
const AlertsPage = lazy(() =>
  import('./features/workspace/WorkspacePages').then((module) => ({
    default: module.AlertsPage,
  })),
)
const ReportsPage = lazy(() =>
  import('./features/workspace/WorkspacePages').then((module) => ({
    default: module.ReportsPage,
  })),
)
const DevicesPage = lazy(() =>
  import('./features/workspace/WorkspacePages').then((module) => ({
    default: module.DevicesPage,
  })),
)

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ConfirmProvider>
          <BrowserRouter>
            <Suspense
              fallback={
                <div className="p-8">
                  <PageSkeleton />
                </div>
              }
            >
              <Routes>
                <Route path="/login" element={<LoginPage />} />
                <Route
                  path="/accept-invitation"
                  element={<AcceptInvitationPage />}
                />
                <Route element={<ProtectedRoute />}>
                  <Route
                    element={
                      <OrganizationBoundary>
                        <ManagerLayout />
                      </OrganizationBoundary>
                    }
                  >
                    <Route
                      path="/organizations"
                      element={<OrganizationsPage />}
                    />
                    <Route path="/" element={<DashboardPage />} />
                    <Route path="/employees" element={<EmployeesPage />} />
                    <Route path="/departments" element={<DepartmentsPage />} />
                    <Route
                      path="/designations"
                      element={<DesignationsPage />}
                    />
                    <Route path="/shifts" element={<ShiftsPage />} />
                    <Route path="/sites" element={<SitesPage />} />
                    <Route
                      path="/location-logs"
                      element={<LocationLogsPage />}
                    />
                    <Route
                      path="/presence"
                      element={<PresenceSessionsPage />}
                    />
                    <Route path="/assignments" element={<AssignmentsPage />} />
                    <Route path="/audit" element={<AuditLogsPage />} />
                    <Route
                      path="/live-tracking"
                      element={<LiveTrackingPage />}
                    />
                    <Route
                      path="/entry-exit"
                      element={<PresenceSessionsPage entryExit />}
                    />
                    <Route path="/alerts" element={<AlertsPage />} />
                    <Route path="/reports" element={<ReportsPage />} />
                    <Route path="/devices" element={<DevicesPage />} />
                    <Route path="/users" element={<OrganizationUsersPage />} />
                    <Route
                      path="/settings"
                      element={<OrganizationSettingsPage />}
                    />
                  </Route>
                </Route>
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </Suspense>
          </BrowserRouter>
        </ConfirmProvider>
      </AuthProvider>
    </QueryClientProvider>
  )
}

export default App
