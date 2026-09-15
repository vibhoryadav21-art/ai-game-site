'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import { useLanguage } from '@/context/LanguageContext'

const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'de', label: 'Deutsch' },
  { code: 'ar', label: 'العربية' },
]

function Logo() {
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true">
      <rect width="28" height="28" rx="7" fill="#064e3b" />
      <text x="7" y="12" fontSize="9" fill="#f59e0b" textAnchor="middle">♠</text>
      <text x="21" y="12" fontSize="9" fill="#fb7185" textAnchor="middle">♥</text>
      <text x="7" y="23" fontSize="9" fill="#fb7185" textAnchor="middle">♦</text>
      <text x="21" y="23" fontSize="9" fill="#f59e0b" textAnchor="middle">♣</text>
    </svg>
  )
}

export default function NavBar() {
  const [user, setUser] = useState(null)
  const [checked, setChecked] = useState(false)
  const router = useRouter()
  const { language, setLanguage, t } = useLanguage()

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
      <Link href="/" className="flex items-center gap-2 text-amber-300 font-serif text-lg">
        <Logo />
        {t.siteName}
      </Link>

      <div className="flex items-center gap-4 text-sm">
        <Link href="/game" className="text-emerald-200 hover:text-amber-300 transition">
          {t.nav.play}
        </Link>

        <select
          value={language}
          onChange={(e) => setLanguage(e.target.value)}
          className="bg-emerald-900 border border-emerald-700/50 text-emerald-200 text-xs rounded-lg px-2 py-1 focus:outline-none focus:border-amber-400"
          aria-label="Language"
        >
          {LANGUAGES.map((lang) => (
            <option key={lang.code} value={lang.code}>
              {lang.label}
            </option>
          ))}
        </select>

        {!checked ? null : user ? (
          <>
            <span className="text-emerald-300 hidden sm:inline">{user.email}</span>
            <button
              onClick={handleLogout}
              className="text-emerald-200 hover:text-amber-300 transition"
            >
              {t.nav.logout}
            </button>
          </>
        ) : (
          <>
            <Link href="/login" className="text-emerald-200 hover:text-amber-300 transition">
              {t.nav.login}
            </Link>
            <Link
              href="/signup"
              className="bg-amber-500 hover:bg-amber-400 text-emerald-950 font-medium px-3 py-1.5 rounded-lg transition"
            >
              {t.nav.signup}
            </Link>
          </>
        )}
      </div>
    </nav>
  )
}
