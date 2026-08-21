import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim()
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim()

const missingVars = [
  !supabaseUrl && 'VITE_SUPABASE_URL',
  !supabaseAnonKey && 'VITE_SUPABASE_ANON_KEY',
].filter(Boolean)

if (missingVars.length > 0) {
  throw new Error(
    `Missing Supabase environment variables: ${missingVars.join(', ')}. ` +
      'Locally: add them to .env and restart the dev server. ' +
      'On Vercel/Netlify: add them under Project → Settings → Environment Variables, then redeploy ' +
      '(Vite inlines VITE_* variables at build time).',
  )
}

let parsedUrl: URL
try {
  parsedUrl = new URL(supabaseUrl!)
} catch {
  throw new Error(`VITE_SUPABASE_URL is not a valid URL: "${supabaseUrl}"`)
}
if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') {
  throw new Error(`VITE_SUPABASE_URL must start with https:// — got: "${supabaseUrl}"`)
}

// Accepts both key formats: legacy JWT anon keys and new "sb_publishable_..." keys.
const isLegacyJwtKey =
  supabaseAnonKey!.startsWith('eyJ') && supabaseAnonKey!.split('.').length === 3
const isPublishableKey = supabaseAnonKey!.startsWith('sb_publishable_')
if (!isLegacyJwtKey && !isPublishableKey) {
  throw new Error(
    'VITE_SUPABASE_ANON_KEY does not look like a valid Supabase anon/publishable key ' +
      '(expected a JWT or an "sb_publishable_..." key). Check your .env file.',
  )
}

export const supabase = createClient(supabaseUrl!, supabaseAnonKey!, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
  // NOTE: Do NOT set a static `Authorization` header here. supabase-js injects
  // the signed-in user's JWT per request and only falls back to the anon key
  // when no Authorization header is already present. A static value would
  // shadow the user token and make every request run as the `anon` role.
  global: {
    headers: {
      apikey: supabaseAnonKey!,
    },
  },
})
