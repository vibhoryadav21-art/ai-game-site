'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { useLanguage } from '@/context/LanguageContext'

export default function Sidebar({ isOpen, onClose, user, checked, onLogout }) {
  const { t, language } = useLanguage()
  const isRtl = language === 'ar'

  // Auto-hide: close on Escape
  useEffect(() => {
    function handleKey(e) {
      if (e.key === 'Escape') onClose()
    }
    if (isOpen) document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [isOpen, onClose])

  // Auto-hide: lock body scroll while open
  useEffect(() => {
    document.body.style.overflow = isOpen ? 'hidden' : ''
    return () => {
      document.body.style.overflow = ''
    }
  }, [isOpen])

  const sideClass = isRtl ? 'right-0 border-l' : 'left-0 border-r'
  const hiddenTranslate = isRtl ? 'translate-x-full' : '-translate-x-full'

  return (
    <>
      {/* Backdrop - click to close */}
      <div
        onClick={onClose}
        className={`fixed inset-0 bg-black/50 z-40 transition-opacity ${
          isOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
        aria-hidden="true"
      />

      {/* Panel */}
      <aside
        className={`fixed top-0 h-full w-64 bg-black border-zinc-800 z-50
          flex flex-col justify-between px-4 py-6 text-sm
          transform transition-transform duration-300 ease-in-out
          ${sideClass}
          ${isOpen ? 'translate-x-0' : hiddenTranslate}`}
        aria-hidden={!isOpen}
      >
        {/* Top links */}
        <div className="flex flex-col gap-4">
          <Link
            href="/learning"
            onClick={onClose}
            className="text-blue-200 hover:text-sky-300 transition"
          >
            {t.nav.learning}
          </Link>
          <Link
            href="/games"
            onClick={onClose}
            className="text-blue-200 hover:text-sky-300 transition"
          >
            {t.nav.games}
          </Link>
        </div>

        {/* Bottom: about, username, logout (or login/signup) */}
        <div className="flex flex-col gap-4 border-t border-zinc-800 pt-4">
          <Link
            href="/about"
            onClick={onClose}
            className="text-blue-200 hover:text-sky-300 transition"
          >
            {t.nav.about}
          </Link>

          {!checked ? null : user ? (
            <>
              <span className="text-blue-300 truncate">{user.email}</span>
              <button
                onClick={() => {
                  onLogout()
                  onClose()
                }}
                className="text-left text-blue-200 hover:text-sky-300 transition"
              >
                {t.nav.logout}
              </button>
            </>
          ) : (
            <>
              <Link
                href="/login"
                onClick={onClose}
                className="text-blue-200 hover:text-sky-300 transition"
              >
                {t.nav.login}
              </Link>
              <Link
                href="/signup"
                onClick={onClose}
                className="bg-sky-500 hover:bg-sky-400 text-blue-950 font-medium px-3 py-1.5 rounded-lg text-center transition"
              >
                {t.nav.signup}
              </Link>
            </>
          )}
        </div>
      </aside>
    </>
  )
}
