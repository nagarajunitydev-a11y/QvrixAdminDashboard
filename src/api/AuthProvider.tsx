import type { Session, User } from '@supabase/auth-js'
import { supabase } from './supabase'
import { queryClient } from './queryClient'
import type { ReactNode } from 'react'
import { createContext, useContext, useEffect, useState } from 'react'

interface AuthContextType {
  session: Session | null
  user: User | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<Session | null>
  signOut: () => Promise<void>
  isManager: boolean
  role: string | null
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider')
  }
  return context
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  const role = user?.user_metadata?.role?.toString() ?? null
  const isManager = role === 'manager'

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setUser(session?.user ?? null)
      setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setSession(session)
        setUser(session?.user ?? null)
        setLoading(false)
      }
    )

    return () => subscription.unsubscribe()
  }, [])

  const signIn = async (email: string, password: string): Promise<Session | null> => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
    setSession(data.session)
    setUser(data.session?.user ?? null)
    setLoading(false)
    return data.session
  }

  const signOut = async () => {
    const { error } = await supabase.auth.signOut()
    if (error) throw error
    queryClient.clear()
  }

  return (
    <AuthContext.Provider
      value={{ session, user, loading, signIn, signOut, isManager, role }}
    >
      {children}
    </AuthContext.Provider>
  )
}
