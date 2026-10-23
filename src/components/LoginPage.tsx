import { useState, type FormEvent } from 'react'
import { Brand } from './Brand'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../api/AuthProvider'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { Alert, AlertDescription } from './ui/alert'
import {
  Mail,
  Lock,
  ArrowRight,
  ShieldCheck,
  Eye,
  EyeOff,
  MapPin,
  Users,
  Activity,
} from 'lucide-react'

const REMEMBER_KEY = 'mc-remembered-email'

export function LoginPage() {
  const [email, setEmail] = useState(
    () => localStorage.getItem(REMEMBER_KEY) ?? '',
  )
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(
    () => localStorage.getItem(REMEMBER_KEY) !== null,
  )
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const { signIn } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  const from =
    (location.state as { from?: { pathname: string } })?.from?.pathname || '/'

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setIsLoading(true)
    try {
      await signIn(email, password)
      if (remember) {
        localStorage.setItem(REMEMBER_KEY, email)
      } else {
        localStorage.removeItem(REMEMBER_KEY)
      }
      navigate(from, { replace: true })
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Login failed')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
      <aside className="login-scene relative hidden overflow-hidden p-12 text-white lg:flex lg:flex-col xl:p-16">
        <div className="login-grid pointer-events-none absolute inset-0" />
        <div className="relative">
          <Brand />
        </div>
        <div className="relative my-auto py-16">
          <span className="inline-flex items-center gap-2 rounded-full border border-teal-200/15 bg-teal-300/5 px-3 py-1.5 text-[10px] tracking-wider text-teal-200">
            <span className="h-1.5 w-1.5 rounded-full bg-teal-300" />
            WORKFORCE MANAGEMENT, REFINED
          </span>
          <h1 className="mt-7 max-w-lg font-headline text-[48px] font-medium leading-[1.13] tracking-[-.04em] xl:text-[58px]">
            Your people.
            <br />
            Your operations.
            <br />
            <span className="text-teal-300">Perfectly in sync.</span>
          </h1>
          <p className="mt-6 max-w-sm text-sm leading-7 text-slate-400">
            One clear view of your workforce. Bring your teams, locations, and
            everyday operations together.
          </p>
          <div className="mt-10 grid max-w-md grid-cols-3 gap-4 border-t border-white/10 pt-6">
            {[
              { icon: MapPin, label: 'Location visibility' },
              { icon: Users, label: 'Connected teams' },
              { icon: Activity, label: 'Daily insights' },
            ].map(({ icon: Icon, label }) => (
              <div key={label}>
                <Icon className="mb-3 h-5 w-5 text-teal-300/80" />
                <span className="text-[10px] text-slate-400">{label}</span>
              </div>
            ))}
          </div>
        </div>
        <p className="relative text-[10px] tracking-wide text-slate-500">
          Crewtraxa Console <span className="mx-3">/</span> Every Team. Every
          Site. In Sync.
        </p>
      </aside>
      <main className="flex min-w-0 flex-col items-center justify-center bg-card px-6 py-12 sm:px-12">
        <div className="mb-12 lg:hidden">
          <Brand />
        </div>
        <div className="w-full max-w-[360px]">
          <p className="eyebrow text-primary">WELCOME TO TRACKORA CONSOLE</p>
          <h2 className="mt-3 font-headline text-[32px] font-semibold tracking-tight">
            Good to see you again.
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            Sign in to keep your workforce moving in sync.
          </p>
          <form className="mt-8 flex flex-col gap-5" onSubmit={handleSubmit}>
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <div className="space-y-2">
              <Label htmlFor="email">Work email</Label>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3.5 top-3.5 h-4 w-4 text-muted-foreground" />
                <Input
                  id="email"
                  type="email"
                  autoComplete="username"
                  placeholder="you@company.com"
                  className="h-11 rounded-lg pl-10"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  disabled={isLoading}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3.5 top-3.5 h-4 w-4 text-muted-foreground" />
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder="Enter your password"
                  className="h-11 rounded-lg pl-10 pr-11"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  disabled={isLoading}
                />
                <button
                  type="button"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  aria-pressed={showPassword}
                  className="absolute right-1.5 top-1.5 rounded-md p-2 text-muted-foreground"
                  onClick={() => setShowPassword((v) => !v)}
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-input accent-primary"
              />
              <span className="text-xs text-muted-foreground">
                Remember my email
              </span>
            </label>
            <Button
              type="submit"
              className="mt-1 h-11 w-full rounded-lg"
              disabled={isLoading}
            >
              <span>
                {isLoading ? 'Signing in…' : 'Sign in to your workspace'}
              </span>
              {!isLoading && <ArrowRight className="ml-auto h-4 w-4" />}
            </Button>
          </form>
          <div className="mt-8 flex items-center justify-center gap-2 border-t pt-6 text-[11px] text-muted-foreground">
            <ShieldCheck className="h-3.5 w-3.5 text-primary" />
            Secure access for organization members
          </div>
          <p className="mt-12 text-center text-[10px] text-muted-foreground lg:hidden">
            Every Team. Every Site. In Sync.
          </p>
        </div>
      </main>
    </div>
  )
}
