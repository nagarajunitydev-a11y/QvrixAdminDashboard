import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from './api/AuthProvider'
import { queryClient } from './api/queryClient'
import { ProtectedRoute } from './auth/ProtectedRoute'
import { ManagerLayout } from './components/ManagerLayout'
import { LoginPage } from './components/LoginPage'

// Lazy-loaded feature pages
import { DashboardPage } from './features/dashboard/DashboardPage'
import { EmployeesPage } from './features/employees/EmployeesPage'
import { DepartmentsPage } from './features/departments/DepartmentsPage'
import { DesignationsPage } from './features/designations/DesignationsPage'
import { ShiftsPage } from './features/shifts/ShiftsPage'
import { SitesPage } from './features/sites/SitesPage'
import { LocationLogsPage } from './features/location-logs/LocationLogsPage'
import { PresenceSessionsPage } from './features/presence/PresenceSessionsPage'
import { AssignmentsPage } from './features/employee-sites/AssignmentsPage'
import { AuditLogsPage } from './features/audit-logs/AuditLogsPage'

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route element={<ProtectedRoute />}>
              <Route element={<ManagerLayout />}>
                <Route path="/" element={<DashboardPage />} />
                <Route path="/employees" element={<EmployeesPage />} />
                <Route path="/departments" element={<DepartmentsPage />} />
                <Route path="/designations" element={<DesignationsPage />} />
                <Route path="/shifts" element={<ShiftsPage />} />
                <Route path="/sites" element={<SitesPage />} />
                <Route path="/location-logs" element={<LocationLogsPage />} />
                <Route path="/presence" element={<PresenceSessionsPage />} />
                <Route path="/assignments" element={<AssignmentsPage />} />
                <Route path="/audit" element={<AuditLogsPage />} />
              </Route>
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  )
}

export default App
