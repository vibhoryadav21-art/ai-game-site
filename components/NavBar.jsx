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
    <img
      src="/logo-az.png"
      alt="auszeit."
      className="h-6 w-auto"
    />
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
    <nav className="w-full bg-black border-b border-zinc-800 px-6 py-3 flex items-center justify-between">
      <Link href="/" className="flex items-center">
        <Logo />
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
