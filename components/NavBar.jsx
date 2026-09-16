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
      <circle cx="14" cy="14" r="3" fill="#f59e0b" />
      <ellipse
        cx="14" cy="14" rx="12" ry="5"
        fill="none" stroke="#34d399" strokeOpacity="0.6" strokeWidth="1"
        transform="rotate(-25 14 14)"
      />
      <ellipse
        cx="14" cy="14" rx="9" ry="12"
        fill="none" stroke="#fb7185" strokeOpacity="0.5" strokeWidth="1"
        transform="rotate(35 14 14)"
      />
      <circle cx="24.5" cy="9" r="1.6" fill="#34d399" />
      <circle cx="6" cy="21" r="1.3" fill="#fb7185" />
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
        <Link href="/about" className="text-emerald-200 hover:text-amber-300 transition">
          {t.nav.about}
        </Link>
        <Link href="/games" className="text-emerald-200 hover:text-amber-300 transition">
          {t.nav.games}
        </Link>
        <Link href="/learning" className="text-emerald-200 hover:text-amber-300 transition">
          {t.nav.learning}
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
