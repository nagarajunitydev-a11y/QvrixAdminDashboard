# Crewtraxa Console

Every Team. Every Site. In Sync.

Workforce administration dashboard built with React, TypeScript, Vite, and Supabase.

## Organization support

Crewtraxa Workforce uses server-managed organization memberships, site scopes, and PostgreSQL RLS. Crewtraxa Console includes organization management, switching, scoped dashboards/search/CRUD, invitations, user roles, and organization settings. The employee product identity is Crewtraxa Employee.

**Deployment is pending:** apply and verify the database migration and bootstrap a verified Super Admin before deploying the new console. Live Supabase isolation and employee-device/offline tests have not run. See [the migration, setup, permission matrix, compatibility limits, and release checklist](docs/multi-organization.md).

Use [the current backend deployment instructions](docs/organization-deployment.md) for both required organization migrations, secure project validation, atomic migration history, Super Admin bootstrap, and real browser verification.

Run `npm run test:tenancy`, `npm run typecheck`, `npm run lint`, `npm run build`, and `npm run test:ui` for local verification. Direct live API tests are separate: `npm run test:tenancy:live`.

`npm run test:ui:live` opens the local Console with Playwright and calls the configured real Supabase API without intercepting requests. It fails while organization objects return 404. Its authenticated browser test requires the dedicated A admin JWT and organization A/B IDs documented in [the deployment guide](docs/multi-organization.md); without them it is explicitly skipped. Live traces are disabled to avoid saving test sessions.

## Local setup

Copy `.env.example` to `.env` in the project root before starting the app:

```powershell
Copy-Item .env.example .env
npm install
npm run dev
```

Ensure `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` contain your Supabase project URL and public anon/publishable key. Restart the dev server after changing these values. The local `.env` file is ignored by Git.

For Vercel or Netlify, set both variables in the project's environment settings before building, then redeploy. Vite embeds these values at build time.

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend enabling type-aware lint rules by installing `oxlint-tsgolint` and editing `.oxlintrc.json`:

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["react", "typescript", "oxc"],
  "options": {
    "typeAware": true
  },
  "rules": {
    "react/rules-of-hooks": "error",
    "react/only-export-components": ["warn", { "allowConstantExport": true }]
  }
}
```

See the [Oxlint rules documentation](https://oxc.rs/docs/guide/usage/linter/rules) for the full list of rules and categories.
