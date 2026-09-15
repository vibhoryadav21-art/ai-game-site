'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'

export default function NavBar() {
  const [user, setUser] = useState(null)
  const [checked, setChecked] = useState(false)
  const router = useRouter()

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null)
      setChecked(true)
    })

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
    })

    return () => listener.subscription.unsubscribe()
  }, [])

  async function handleLogout() {
    await supabase.auth.signOut()
    router.push('/')
    router.refresh()
  }

  return (
    <nav className="w-full bg-emerald-950 border-b border-emerald-800 px-6 py-3 flex items-center justify-between">
      <Link href="/" className="text-amber-300 font-serif text-lg">
        AI Game Site
      </Link>

      <div className="flex items-center gap-4 text-sm">
        <Link href="/game" className="text-emerald-200 hover:text-amber-300 transition">
          Play
        </Link>

        {!checked ? null : user ? (
          <>
            <span className="text-emerald-300 hidden sm:inline">{user.email}</span>
            <button
              onClick={handleLogout}
              className="text-emerald-200 hover:text-amber-300 transition"
            >
              Log out
            </button>
          </>
        ) : (
          <>
            <Link href="/login" className="text-emerald-200 hover:text-amber-300 transition">
              Log in
            </Link>
            <Link
              href="/signup"
              className="bg-amber-500 hover:bg-amber-400 text-emerald-950 font-medium px-3 py-1.5 rounded-lg transition"
            >
              Sign up
            </Link>
          </>
        )}
      </div>
    </nav>
  )
}
