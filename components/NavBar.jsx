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
  { code: 'ru', label: 'Русский' },
]

function Logo() {
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true">
      {/* Prism triangle */}
      <path
        d="M14 4 L22 18 L6 18 Z"
        fill="none"
        stroke="#e0f2fe"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      {/* Dispersed rainbow rays */}
      <line x1="14" y1="4" x2="20.5" y2="25" stroke="#f87171" strokeWidth="1" strokeLinecap="round" />
      <line x1="14" y1="4" x2="18" y2="25.5" stroke="#fb923c" strokeWidth="1" strokeLinecap="round" />
      <line x1="14" y1="4" x2="15.5" y2="26" stroke="#facc15" strokeWidth="1" strokeLinecap="round" />
      <line x1="14" y1="4" x2="12.5" y2="26" stroke="#4ade80" strokeWidth="1" strokeLinecap="round" />
      <line x1="14" y1="4" x2="10" y2="25.5" stroke="#38bdf8" strokeWidth="1" strokeLinecap="round" />
      <line x1="14" y1="4" x2="7.5" y2="25" stroke="#a78bfa" strokeWidth="1" strokeLinecap="round" />
      {/* Wave beneath, keeping the ocean identity */}
      <path
        d="M4 23 Q 7 21 10 23 T 16 23 T 22 23 T 24 22"
        fill="none"
        stroke="#0ea5e9"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
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
    <nav className="w-full bg-blue-950 border-b border-blue-800 px-6 py-3 flex items-center justify-between">
      <Link href="/" className="flex items-center gap-2 text-sky-300 font-serif text-lg">
        <Logo />
        {t.siteName}
      </Link>

      <div className="flex items-center gap-4 text-sm">
        <Link href="/about" className="text-blue-200 hover:text-sky-300 transition">
          {t.nav.about}
        </Link>
        <Link href="/games" className="text-blue-200 hover:text-sky-300 transition">
          {t.nav.games}
        </Link>
        <Link href="/learning" className="text-blue-200 hover:text-sky-300 transition">
          {t.nav.learning}
        </Link>

        <select
          value={language}
          onChange={(e) => setLanguage(e.target.value)}
          className="bg-blue-900 border border-blue-700/50 text-blue-200 text-xs rounded-lg px-2 py-1 focus:outline-none focus:border-sky-400"
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
            <span className="text-blue-300 hidden sm:inline">{user.email}</span>
            <button
              onClick={handleLogout}
              className="text-blue-200 hover:text-sky-300 transition"
            >
              {t.nav.logout}
            </button>
          </>
        ) : (
          <>
            <Link href="/login" className="text-blue-200 hover:text-sky-300 transition">
              {t.nav.login}
            </Link>
            <Link
              href="/signup"
              className="bg-sky-500 hover:bg-sky-400 text-blue-950 font-medium px-3 py-1.5 rounded-lg transition"
            >
              {t.nav.signup}
            </Link>
          </>
        )}
      </div>
    </nav>
  )
}
