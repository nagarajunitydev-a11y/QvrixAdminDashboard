import { useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../api/AuthProvider'
import { supabase } from '../api/supabase'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { Alert, AlertDescription } from './ui/alert'
import {
  ArrowRight,
  Building2,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  Mail,
  MapPinned,
  Radar,
  ShieldCheck,
  Sparkles,
} from 'lucide-react'

const REMEMBER_KEY = 'mc-remembered-email'

const highlights = [
  {
    icon: MapPinned,
    title: 'Geofenced attendance',
    description: 'Sites, radii, and map-based editing in one workspace.',
  },
  {
    icon: Radar,
    title: 'Live workforce view',
    description: 'See who is on site, in transit, or out of signal.',
  },
  {
    icon: ShieldCheck,
    title: 'Manager-only access',
    description: 'Role-checked sign-in backed by Supabase Auth.',
  },
]

export function LoginPage({ mode = 'login' }: { mode?: 'login' | 'forgot' | 'reset' }) {
  const [email, setEmail] = useState(() => localStorage.getItem(REMEMBER_KEY) ?? '')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [resetComplete, setResetComplete] = useState(false)
  const [recoveryError] = useState(() => {
    const hash = new URLSearchParams(window.location.hash.slice(1))
    const search = new URLSearchParams(window.location.search)
    return hash.has('error') || hash.has('error_code') || search.has('error') || search.has('error_code')
  })
  const [remember, setRemember] = useState(() => localStorage.getItem(REMEMBER_KEY) !== null)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const { signIn, session, loading, isPasswordRecovery, signOut } = useAuth()
  const isReset = mode === 'reset'
  const isForgot = mode === 'forgot'
  const invalidReset = isReset && !loading && (!session || recoveryError) && !resetComplete
  const navigate = useNavigate()
  const location = useLocation()

  const from = (location.state as { from?: { pathname: string } })?.from?.pathname || '/'

  const backToLogin = async () => {
    setIsLoading(true)
    setError(null)
    try {
      if (isReset) await signOut()
      navigate('/login', { replace: true })
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to sign out. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setMessage(null)
    setIsLoading(true)
    try {
      if (isForgot) {
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: new URL('/reset-password', window.location.origin).href,
        })
        if (error) throw error
        setMessage('If an account exists for this email, you will receive a password reset link. Check your inbox and spam folder.')
        return
      }
      if (isReset) {
        if (invalidReset || loading) return
        if (password !== confirmPassword) {
          setError('Passwords do not match.')
          return
        }
        const { error } = await supabase.auth.updateUser({ password })
        if (error) throw error
        setResetComplete(true)
        setPassword('')
        setConfirmPassword('')
        setMessage('Your password has been updated. You can now sign in with your new password.')
        await signOut()
        return
      }
      const session = await signIn(email, password)
      const role = session?.user?.user_metadata?.role?.toString() ?? null
      if (role !== 'manager') {
        setError('Access denied. Only managers can log in.')
        return
      }
      if (remember) {
        localStorage.setItem(REMEMBER_KEY, email)
      } else {
        localStorage.removeItem(REMEMBER_KEY)
      }
      navigate(from, { replace: true })
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }

  if (mode === 'login' && isPasswordRecovery) {
    return <Navigate to="/reset-password" replace />
  }

  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-background lg:flex-row">
      <div className="pointer-events-none absolute inset-0 map-grid opacity-40" aria-hidden />
      <div
        className="pointer-events-none absolute -left-32 -top-40 h-[520px] w-[520px] rounded-full bg-primary/10 blur-3xl"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute -bottom-48 right-0 h-[420px] w-[420px] rounded-full bg-teal-500/10 blur-3xl"
        aria-hidden
      />

      {/* Brand panel */}
      <aside className="relative hidden w-[46%] flex-col justify-between overflow-hidden bg-sidebar px-10 py-10 text-white lg:flex xl:px-14">
        <div className="pointer-events-none absolute inset-0 opacity-[0.07]" aria-hidden>
          <div className="absolute -right-24 top-10 h-80 w-80 rounded-full border border-white" />
          <div className="absolute -right-10 top-32 h-80 w-80 rounded-full border border-white" />
          <div className="absolute -bottom-20 -left-10 h-72 w-72 rounded-full border border-white" />
        </div>

        <div className="relative">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-xl bg-white/95 shadow-lg shadow-primary/30 ring-1 ring-inset ring-white/20">
              <img src="/crewtraxa-pin.png" alt="Crewtraxa" className="h-8 w-8 object-contain" />
            </div>
            <div>
              <p className="font-headline text-[22px] font-bold leading-tight tracking-tight">
                Crewtraxa
              </p>
              <p className="font-label text-[10px] uppercase tracking-[0.2em] text-sidebar-muted">
                Crew Tracking Console
              </p>
            </div>
          </div>

          <div className="mt-16 max-w-md">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 font-label text-[10px] uppercase tracking-[0.16em] text-teal-200">
              <Sparkles className="h-3 w-3" /> Operations intelligence
            </span>
            <h1 className="mt-4 font-headline text-[38px] font-bold leading-[1.1] tracking-tight xl:text-[44px]">
              Every site.
              <br />
              Every shift.
              <br />
              <span className="bg-gradient-to-r from-teal-300 to-primary bg-clip-text text-transparent">
                In view.
              </span>
            </h1>
            <p className="mt-4 max-w-sm text-[15px] leading-relaxed text-sidebar-muted">
              A single console for geofenced attendance, live workforce tracking, and the records
              behind every shift.
            </p>
          </div>

          <ul className="mt-10 space-y-3.5">
            {highlights.map(({ icon: Icon, title, description }) => (
              <li key={title} className="flex items-start gap-3">
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/[0.06] text-teal-300 ring-1 ring-inset ring-white/10">
                  <Icon className="h-4 w-4" />
                </span>
                <div>
                  <p className="font-label text-label-md font-semibold text-white">{title}</p>
                  <p className="text-[12px] leading-relaxed text-sidebar-muted">{description}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div className="relative mt-12 flex items-center gap-6 border-t border-white/10 pt-5 text-sidebar-muted">
          <div>
            <p className="font-headline text-lg font-semibold text-white">11</p>
            <p className="text-[10px] uppercase tracking-wider">Workspace modules</p>
          </div>
          <div className="h-8 w-px bg-white/10" />
          <div>
            <p className="font-headline text-lg font-semibold text-white">OSM</p>
            <p className="text-[10px] uppercase tracking-wider">Keyless basemap</p>
          </div>
          <div className="h-8 w-px bg-white/10" />
          <div>
            <p className="font-headline text-lg font-semibold text-white">RLS</p>
            <p className="text-[10px] uppercase tracking-wider">Supabase data</p>
          </div>
        </div>
      </aside>

      {/* Sign in */}
      <main className="relative flex flex-1 items-center justify-center px-4 py-10 sm:px-8">
        <div className="w-full max-w-[420px]">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-xl bg-primary/10 ring-1 ring-inset ring-primary/20">
              <img src="/crewtraxa-pin.png" alt="Crewtraxa" className="h-8 w-8 object-contain" />
            </div>
            <div>
              <p className="font-headline text-xl font-bold leading-tight text-foreground">
                Crewtraxa
              </p>
              <p className="font-label text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                Crew Tracking Console
              </p>
            </div>
          </div>

          <div className="rounded-2xl border border-border/80 bg-card/95 p-6 shadow-premium backdrop-blur sm:p-8">
            <div className="mb-6">
              <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-inset ring-primary/15">
                <KeyRound className="h-5 w-5" />
              </div>
              <h2 className="font-headline text-headline-lg text-foreground">
                {isForgot ? 'Forgot password?' : isReset ? 'Reset your password' : 'Welcome back'}
              </h2>
              <p className="mt-1 text-body-sm text-muted-foreground">
                {isForgot ? 'Enter your email address to receive a password reset link.' : isReset ? 'Choose a new password for your account.' : 'Sign in to the Crewtraxa manager console.'}
              </p>
            </div>

            <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              {message && (
                <Alert variant="success">
                  <AlertDescription>{message}</AlertDescription>
                </Alert>
              )}
              {invalidReset && (
                <Alert variant="destructive">
                  <AlertDescription>This password reset link is invalid or has expired. Request a new link to try again.</AlertDescription>
                </Alert>
              )}
              {isReset && loading && <p role="status" className="text-body-sm text-muted-foreground">Checking your reset link...</p>}

              {!isReset && (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="email" className="text-label-md text-foreground">
                    Email address
                  </Label>
                  <div className="relative">
                    <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="email"
                      type="email"
                      placeholder="you@company.com"
                      className="h-10 pl-9"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      disabled={isLoading}
                      autoComplete="email"
                    />
                  </div>
                </div>
              )}

              {!isForgot && !resetComplete && !invalidReset && (
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="password" className="text-label-md text-foreground">
                      {isReset ? 'New password' : 'Password'}
                    </Label>
                    {!isReset && <Link to="/forgot-password" className="text-xs text-primary hover:underline">Forgot password?</Link>}
                  </div>
                  <div className="relative">
                    <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="password"
                      type={showPassword ? 'text' : 'password'}
                      placeholder="••••••••"
                      className="h-10 pl-9 pr-12"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      disabled={isLoading || (isReset && loading)}
                      minLength={isReset ? 8 : undefined}
                      autoComplete={isReset ? 'new-password' : 'current-password'}
                    />
                    <button
                      type="button"
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      aria-controls="password"
                      aria-pressed={showPassword}
                      onClick={() => setShowPassword((visible) => !visible)}
                      disabled={isLoading || (isReset && loading)}
                      className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-md text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
                    </button>
                  </div>
                </div>
              )}
              {isReset && !resetComplete && !invalidReset && (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="confirm-password">Confirm new password</Label>
                  <div className="relative">
                    <Input
                      id="confirm-password"
                      type={showConfirmPassword ? 'text' : 'password'}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      minLength={8}
                      required
                      disabled={isLoading || loading}
                      autoComplete="new-password"
                      className="h-10 pr-12"
                    />
                    <button
                      type="button"
                      aria-label={showConfirmPassword ? 'Hide confirm password' : 'Show confirm password'}
                      aria-controls="confirm-password"
                      aria-pressed={showConfirmPassword}
                      onClick={() => setShowConfirmPassword((visible) => !visible)}
                      disabled={isLoading || loading}
                      className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-md text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                    >
                      {showConfirmPassword ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
                    </button>
                  </div>
                  <p className="text-xs text-muted-foreground">Use at least 8 characters.</p>
                </div>
              )}

              {!isForgot && !isReset && (
                <label className="flex cursor-pointer select-none items-center gap-2">
                  <input
                    type="checkbox"
                    checked={remember}
                    onChange={(e) => setRemember(e.target.checked)}
                    className="h-4 w-4 rounded border-input accent-primary"
                  />
                  <span className="text-body-sm text-muted-foreground">Remember my email</span>
                </label>
              )}

              {!resetComplete && !invalidReset && (
                <Button type="submit" className="mt-1 h-10 w-full" disabled={isLoading || (isReset && loading)}>
                  <span>{isForgot ? (isLoading ? 'Sending link...' : 'Send reset link') : isReset ? (isLoading ? 'Updating password...' : 'Update password') : (isLoading ? 'Signing in…' : 'Sign in')}</span>
                  {!isLoading && <ArrowRight className="h-4 w-4" />}
                </Button>
              )}
              {(isForgot || isReset) && (
                <div className="flex flex-col items-center gap-3 text-body-sm">
                  {invalidReset && <Link to="/forgot-password" className="text-primary hover:underline">Request a new reset link</Link>}
                  <Button type="button" variant="link" disabled={isLoading || (isReset && loading)} onClick={backToLogin}>Back to sign in</Button>
                </div>
              )}
            </form>

            <div className="mt-5 flex items-center gap-2 border-t border-border/60 pt-4 text-[11px] text-muted-foreground">
              <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
              Manager role required. Access is checked after authentication.
            </div>
          </div>

          <div className="mt-6 flex items-center justify-center gap-4 text-[10px] text-muted-foreground/80">
            <span className="inline-flex items-center gap-1">
              <Building2 className="h-3 w-3" /> Workforce operations
            </span>
            <span className="h-3 w-px bg-border" />
            <span className="inline-flex items-center gap-1">
              <MapPinned className="h-3 w-3" /> Geofenced attendance
            </span>
          </div>
        </div>
      </main>
    </div>
  )
}
