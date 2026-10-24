# React + TypeScript + Vite

## Password recovery

The sign-in page includes a **Forgot password?** link. Users enter their email,
follow the Supabase recovery email, and choose and confirm a new password at
`/reset-password`. Passwords must contain at least 8 characters; any stricter
password policy configured in Supabase also applies.

In Supabase **Authentication → URL Configuration**, add the application's
`https://<your-domain>/reset-password` URL to **Redirect URLs**, along with
`http://localhost:5173/reset-password` for local development. Set **Site URL** to
the deployed application's URL and configure email delivery for recovery emails.
The host must serve the application for `/forgot-password` and `/reset-password`
(the included Vercel rewrite already supports these routes).

To verify, request a reset for a test account, open the email link, confirm that
mismatched passwords are rejected, save a new password, and sign in with it.
Also check an expired link and opening `/reset-password` while signed out; both
should offer a new reset link.

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
