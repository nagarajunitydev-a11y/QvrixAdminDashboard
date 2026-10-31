import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from './api/AuthProvider'
import { OrganizationProvider } from './api/OrganizationProvider'
import { queryClient } from './api/queryClient'
import { ProtectedRoute } from './auth/ProtectedRoute'
import { ThemeProvider } from './components/ThemeProvider'
import { ToastProvider } from './components/ui/toast'
import { ManagerLayout } from './components/ManagerLayout'
import { LoginPage } from './components/LoginPage'

// Lazy-loaded feature pages
import { DashboardPage } from './features/dashboard/DashboardPage'
import { LiveTrackingPage } from './features/live-tracking/LiveTrackingPage'
import { EmployeesPage } from './features/employees/EmployeesPage'
import { DepartmentsPage } from './features/departments/DepartmentsPage'
import { DesignationsPage } from './features/designations/DesignationsPage'
import { ShiftsPage } from './features/shifts/ShiftsPage'
import { SitesPage } from './features/sites/SitesPage'
import { SiteWorkersPage } from './features/site-workers/SiteWorkersPage'
import { LocationLogsPage } from './features/location-logs/LocationLogsPage'
import { PresenceSessionsPage } from './features/presence/PresenceSessionsPage'
import { AssignmentsPage } from './features/employee-sites/AssignmentsPage'
import { AlertsPage } from './features/alerts/AlertsPage'
import { ReportsPage } from './features/reports/ReportsPage'
import { DevicesPage } from './features/devices/DevicesPage'
import { OrganizationsPage } from './features/organizations/OrganizationsPage'
import { UsersRolesPage } from './features/users/UsersRolesPage'
import { SettingsPage } from './features/settings/SettingsPage'
import { AuditLogsPage } from './features/audit-logs/AuditLogsPage'
import { GettingStartedPage } from './features/onboarding/GettingStartedPage'
import { HolidaysPage } from './features/holidays/HolidaysPage'
import { TimePolicyPage } from './features/time-policy/TimePolicyPage'

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <OrganizationProvider>
          <ThemeProvider>
            <ToastProvider>
              <BrowserRouter>
                <Routes>
                  <Route path="/login" element={<LoginPage key="login" />} />
                  <Route path="/forgot-password" element={<LoginPage key="forgot" mode="forgot" />} />
                  <Route path="/reset-password" element={<LoginPage key="reset" mode="reset" />} />
                  <Route element={<ProtectedRoute />}>
                    <Route element={<ManagerLayout />}>
                      <Route path="/" element={<DashboardPage />} />
                      <Route path="/getting-started" element={<GettingStartedPage />} />
                      <Route path="/live-tracking" element={<LiveTrackingPage />} />
                      <Route path="/employees" element={<EmployeesPage />} />
                      <Route path="/departments" element={<DepartmentsPage />} />
                      <Route path="/designations" element={<DesignationsPage />} />
                      <Route path="/shifts" element={<ShiftsPage />} />
                      <Route path="/holidays" element={<HolidaysPage />} />
                      <Route path="/time-policy" element={<TimePolicyPage />} />
                      <Route path="/sites" element={<SitesPage />} />
                      <Route path="/site-workers" element={<SiteWorkersPage />} />
                      <Route path="/attendance" element={<PresenceSessionsPage />} />
                      <Route path="/presence" element={<PresenceSessionsPage />} />
                      <Route path="/history" element={<LocationLogsPage />} />
                      <Route path="/location-logs" element={<LocationLogsPage />} />
                      <Route path="/alerts" element={<AlertsPage />} />
                      <Route path="/reports" element={<ReportsPage />} />
                      <Route path="/assignments" element={<AssignmentsPage />} />
                      <Route path="/users" element={<UsersRolesPage />} />
                      <Route path="/devices" element={<DevicesPage />} />
                      <Route path="/organizations" element={<OrganizationsPage />} />
                      <Route path="/settings" element={<SettingsPage />} />
                      <Route path="/audit" element={<AuditLogsPage />} />
                    </Route>
                  </Route>
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              </BrowserRouter>
            </ToastProvider>
          </ThemeProvider>
        </OrganizationProvider>
      </AuthProvider>
    </QueryClientProvider>
  )
}

export default App
