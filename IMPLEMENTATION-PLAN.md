# Implementation Plan: Employee Management Admin Web App

## Context

### Existing System
- **Supabase backend**: `https://eqyycmmbcesrtxuawyyb.supabase.co`
- **Mobile apps**: EmployeeTrack (Kotlin/Compose, geofence-driven location tracking) and EmployerTrack (Kotlin/Compose, manager dashboard polling `location_logs`)
- **Auth**: Email provider via GoTrue; role stored in `user.user_metadata["role"]` (`"manager"` for EmployerTrack access)
- **Database**: PostgREST (no Realtime used in mobile apps; EmployerTrack polls every 10s)

### Current Database State
- **Live probe**: PGRST205 ("Could not find the table ... in the schema cache") for all candidate tables from anon key
- **No local migrations/SQL files** exist anywhere in the project tree
- **No local `service_role` key** — cannot distinguish PGRST205 as absent vs no-access. Proceeding with idempotent `IF NOT EXISTS` DDL.

### Mobile Data Model (Room entities ↔ Supabase)
From `employee_track/data/local/entity/` and `employer/data/model/`:
- `sites(id UUID PK, name, latitude, longitude, radius_in_meters=500)`
- `location_logs(id BIGINT PK, user_id UUID, site_id UUID?, latitude, longitude, accuracy, distance_to_site, timestamp epoch-millis, is_inside, is_synced)`
- `presence_sessions(id BIGINT PK, user_id UUID, site_id UUID, entry_timestamp, exit_timestamp?, total_hours?, is_synced)`
- `user_site_selection(user_id UUID PK, selected_site_id)` — **Room-local only, not synced to Supabase**

### Stack Decisions
- **AdminDashboard**: React 18 + TypeScript + Vite (Vite 6+ scaffolds React 19 by default — use `--template react-ts` and keep React 19)
- **Supabase client**: `@supabase/supabase-js@2` (matches mobile v3.7.0 / Flutter v2.17.1 / JS v2)
- **UI framework**: shadcn/ui-style components + Tailwind CSS (no existing web design system)
- **Data layer**: TanStack Query v5 for async data management
- **Maps**: `@react-google-maps/api` (Google Maps API key required)
- **Forms/validation**: `react-hook-form` + `zod`
- **Routing**: React Router v6 DOM
- **Auth state**: `@supabase/auth-helpers-react` (deprecated, use `@supabase/auth-js` types directly)
- **UI primitives**: `@radix-ui/react-dialog`, `@radix-ui/react-select`, `@radix-ui/react-slot`

---

## Ordered Implementation Tasks

### 1. Scaffold project
```bash
npm create vite@latest AdminDashboard -- --template react-ts
cd AdminDashboard
npm install
```

### 2. Install dependencies
```bash
npm install \
  @supabase/supabase-js@^2 \
  @tanstack/react-query@^5 \
  @tanstack/react-table@^8 \
  react-router-dom@^6 \
  @react-google-maps/api@^1 \
  react-hook-form@^7 \
  zod@^3 \
  lucide-react@^0.400 \
  date-fns@^3 \
  clsx@^2 \
  tailwind-merge@^3 \
  class-variance-authority@^0.7 \
  @radix-ui/react-dialog@^1 \
  @radix-ui/react-select@^2 \
  @radix-ui/react-slot@^1 \
  --legacy-peer-deps

npm install --save-dev \
  tailwindcss@^3 \
  postcss@^8 \
  autoprefixer@^10 \
  --legacy-peer-deps
```

### 3. Configure Tailwind + Vite alias
**CRITICAL FIX**: Must add `@` alias to `vite.config.ts` — TypeScript `paths` alone does NOT resolve in Vite's bundler:

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
})
```

Configure `tsconfig.app.json` with baseUrl + paths:
```json
{
  "baseUrl": ".",
  "paths": { "@/*": ["src/*"] }
}
```

Remove `verbatimModuleSyntax: true` from tsconfig — causes issues with type-only imports in Vite 8/Rolldown.

### 4. Set up environment
Create `.env`:
```
VITE_SUPABASE_URL=https://eqyycmmbcesrtxuawyyb.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
VITE_GOOGLE_MAPS_API_KEY=
```

### 5. Create TypeScript types
File: `src/types/database.types.ts` — Full schema interface for all 9 tables (Row/Insert/Update).
File: `src/types/index.ts` — Re-export all types.

### 6. Create Supabase client + auth
- `src/api/supabase.ts` — `createClient(url, key)`
- `src/api/queryClient.ts` — TanStack Query client with sensible defaults
- `src/api/AuthProvider.tsx` — Auth context with role check (import `Session`/`User` types from `@supabase/auth-js`)
- `src/auth/ProtectedRoute.tsx` — ProtectedRoute + ManagerRoute wrappers

### 7. Set up routing
- `src/App.tsx` — Routes: `/login` → LoginPage, all other routes behind ProtectedRoute → ManagerLayout
- `src/components/ManagerLayout.tsx` — Navbar + Sidebar + Outlet
- `src/components/LoginPage.tsx` — Use `import { type FormEvent } from 'react'` not `React.FormEvent` (Vite 8/Rolldown parser issue)

### 8. Create UI component library
shadcn-style components (no `@radix-ui/react-card` — use plain `<div>` with Tailwind):
- `src/components/ui/button.tsx`
- `src/components/ui/input.tsx`
- `src/components/ui/label.tsx`
- `src/components/ui/card.tsx`
- `src/components/ui/badge.tsx`
- `src/components/ui/dialog.tsx` (uses `@radix-ui/react-dialog`)
- `src/components/ui/select.tsx` (uses `@radix-ui/react-select`)
- `src/components/ui/textarea.tsx`
- `src/components/ui/alert.tsx`
- `src/components/ui/data-table.tsx` (TanStack Table v8 wrapper with pagination)
- `src/lib/utils.ts` — `cn()` helper using `clsx` + `tailwind-merge`

### 9. Create API service layer
File: `src/api/services.ts` — Typed CRUD functions for all 9 tables using Supabase PostgREST client.

### 10. Implement feature pages (10 pages)
1. **`src/features/dashboard/DashboardPage.tsx`** — Overview cards + employee presence list
2. **`src/features/employees/EmployeesPage.tsx`** — CRUD with department/designation/shift dropdowns + inline site assignment dialog
3. **`src/features/departments/DepartmentsPage.tsx`** — CRUD table + form dialog
4. **`src/features/designations/DesignationsPage.tsx`** — CRUD table + form dialog
5. **`src/features/shifts/ShiftsPage.tsx`** — CRUD with department filter + form dialog
6. **`src/features/sites/SitesPage.tsx`** — CRUD with lat/lng/radius inputs
7. **`src/features/location-logs/LocationLogsPage.tsx`** — Filterable log table
8. **`src/features/presence/PresenceSessionsPage.tsx`** — Session timeline with date filters
9. **`src/features/employee-sites/AssignmentsPage.tsx`** — Employee-site mapping table + assignment form
10. **`src/features/audit-logs/AuditLogsPage.tsx`** — Audit trail with filters

### 11. Create Supabase schema DDL
File: `supabase/migrations/20260820000000_admin_schema.sql`
- All 9 tables with `CREATE TABLE IF NOT EXISTS`
- RLS policies (role-based via `user_metadata.role`)
- Audit triggers on admin tables
- Indexes for query performance

### 12. Verify
```bash
npx tsc --noEmit    # Must pass with zero errors
npx vite build       # Must produce dist/ bundle
npm run dev         # Must start dev server on http://localhost:5173
```

---

## Schema DDL (Complete Reference)

See the SQL file at `supabase/migrations/20260820000000_admin_schema.sql` for complete DDL including:

- **9 tables**: `sites`, `location_logs`, `presence_sessions` (existing) + `departments`, `designations`, `shifts`, `employees`, `employee_sites`, `audit_logs` (new)
- **RLS policies**: Managers (`user_metadata.role = 'manager'`) have full access; employees have scoped access to their own records
- **Audit triggers**: Auto-log INSERT/UPDATE/DELETE on `employees`, `departments`, `shifts`, `designations`
- **Indexes**: On `user_id`, `site_id`, `timestamp`, `email`, `department_id` for performance

---

## Known Issues & Constraints
1. **Google Maps API key** — Not available locally; `VITE_GOOGLE_MAPS_API_KEY` must be set in `.env`
2. **`@react-google-maps/api` peer dep** — Requires React 16+ but works with React 19; use `--legacy-peer-deps` during install
3. **`@supabase/auth-helpers-react`** — v0.15.0 is the latest available; not v5. Import `Session`/`User` types from `@supabase/auth-js`
4. **Vite alias** — Must configure `@/` alias in both `vite.config.ts` and `tsconfig.app.json`
5. **No `service_role` key** — Cannot distinguish PGRST205 as absent vs no-access; proceeding with idempotent DDL
6. **Env var loading** — Vite loads `.env` at dev server startup. If `.env` is created/edited after `npm run dev`, **must restart** the dev server. Otherwise `import.meta.env.VITE_SUPABASE_ANON_KEY` is `undefined` → client makes requests without the `apikey` header → Supabase returns `"No API key found in request"` (404).
7. **"No API key found" error fix** — Two requirements:
   - **Restart dev server** after `.env` changes: `npm run dev`
   - **Apply schema DDL** to Supabase: tables must exist for CRUD to work. Run `supabase/migrations/20260820000000_admin_schema.sql` via Supabase SQL Editor.

---

## Validation Plan
- [x] `npx tsc --noEmit` passes
- [x] `npx vite build` passes (produces dist/)
- [ ] **Apply schema DDL** to Supabase via SQL Editor (tables must exist before CRUD works)
- [ ] **Restart dev server** after `.env` creation: `npm run dev`
- [ ] Login flow redirects non-managers
- [ ] All pages protected by ProtectedRoute
- [ ] CRUD operations work for all entities (after DDL applied + dev server restarted)
- [ ] Location logs display with filters
- [ ] Real-time updates (optional enhancement)
