'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import { useLanguage } from '@/context/LanguageContext'
import Sidebar from './Sidebar'

const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'de', label: 'Deutsch' },
  { code: 'ar', label: 'العربية' },
  { code: 'ru', label: 'Русский' },
]

function Logo() {
  return <img src="/logo-az.png" alt="auszeit." className="h-6 w-auto" />
}

function MenuButton({ onClick }) {
  return (
    <button
      onClick={onClick}
      aria-label="Open menu"
      className="text-blue-200 hover:text-sky-300 transition p-1"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        className="h-6 w-6"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M4 6h16M4 12h16M4 18h16"
        />
      </svg>
    </button>
  )
}

export default function NavBar() {
  const [user, setUser] = useState(null)
  const [checked, setChecked] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [navHeight, setNavHeight] = useState(0)
  const navRef = useRef(null)
  const router = useRouter()
  const { language, setLanguage } = useLanguage()

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

  // Keep the sidebar's top offset in sync with the navbar's actual height
  useEffect(() => {
    if (!navRef.current) return
    const el = navRef.current

    const update = () => setNavHeight(el.offsetHeight)
    update()

    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  async function handleLogout() {
    await supabase.auth.signOut()
    router.push('/')
    router.refresh()
  }

  return (
    <>
      <nav
        ref={navRef}
        className="relative z-50 w-full bg-black border-b border-zinc-800 px-6 py-3 flex items-center justify-between"
      >
        <div className="flex items-center gap-3">
          <MenuButton onClick={() => setSidebarOpen(true)} />
          <Link href="/" className="flex items-center">
            <Logo />
          </Link>
        </div>

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
      </nav>

      <Sidebar
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        user={user}
        checked={checked}
        onLogout={handleLogout}
        topOffset={navHeight}
      />
    </>
  )
}
