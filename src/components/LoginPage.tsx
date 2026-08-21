import { useState, type FormEvent } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../api/AuthProvider'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { Alert, AlertDescription } from './ui/alert'
import { Rocket, Mail, Lock, ArrowRight, ShieldCheck } from 'lucide-react'

const REMEMBER_KEY = 'mc-remembered-email'

export function LoginPage() {
  const [email, setEmail] = useState(() => localStorage.getItem(REMEMBER_KEY) ?? '')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(() => localStorage.getItem(REMEMBER_KEY) !== null)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const { signIn } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  const from = (location.state as { from?: { pathname: string } })?.from?.pathname || '/'

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setIsLoading(true)
    try {
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
      setError(err instanceof Error ? err.message : 'Login failed')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-muted p-4 sm:p-6">
      <main className="flex w-full max-w-[440px] flex-col overflow-hidden rounded-xl border border-border/60 bg-card shadow-sm">
        <div className="flex flex-col items-center gap-2 px-8 pb-6 pt-8 text-center">
          <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Rocket className="h-7 w-7" />
          </div>
          <h1 className="font-headline text-headline-lg text-foreground">Mission Control</h1>
          <p className="font-label text-label-md uppercase tracking-widest text-muted-foreground">
            Workforce Logistics
          </p>
        </div>

        <div className="flex flex-col gap-6 px-8 pb-8">
          <div className="space-y-1 text-center">
            <h2 className="font-headline text-headline-md text-foreground">Welcome back</h2>
            <p className="text-body-md text-muted-foreground">
              Enter your credentials to access the admin console.
            </p>
          </div>

          <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="email" className="font-label text-label-md text-foreground">
                Email Address
              </Label>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="email"
                  type="email"
                  placeholder="admin@company.com"
                  className="pl-10"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  disabled={isLoading}
                />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="password" className="font-label text-label-md text-foreground">
                Password
              </Label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  className="pl-10"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  disabled={isLoading}
                />
              </div>
            </div>

            <label className="mt-1 flex cursor-pointer items-center gap-2 select-none">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
                className="h-4 w-4 rounded border-input accent-primary"
              />
              <span className="text-body-sm text-muted-foreground transition-colors hover:text-foreground">
                Remember me
              </span>
            </label>

            <Button type="submit" className="mt-2 h-11 w-full rounded-lg" disabled={isLoading}>
              <span>{isLoading ? 'Signing in…' : 'Sign In'}</span>
              {!isLoading && <ArrowRight className="h-4 w-4" />}
            </Button>
          </form>
        </div>
      </main>

      <footer className="mt-6 flex items-center justify-center gap-2 text-muted-foreground/70">
        <ShieldCheck className="h-4 w-4" />
        <span className="font-label text-label-sm uppercase tracking-widest">
          Secure Admin Access
        </span>
      </footer>
    </div>
  )
}
