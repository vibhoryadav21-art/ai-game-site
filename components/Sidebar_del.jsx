'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useLanguage } from '@/context/LanguageContext'
import { useFeedback } from '@/context/FeedbackContext'

// Add more entries here as new learning/games apps ship —
// nothing else in this file needs to change.
const LEARNING_APPS = [
  { href: '/learning/german', img: '/Deutsch.png', alt: 'Deutsch' },
  { href: '/learning/hindi', img: '/Hindi.png', alt: 'Hindi' },
  { href: '/learning/spanish', img: '/Spanish.png', alt: 'Spanish' },
]

const GAME_APPS = [
  { href: '/game', img: '/Higher-Lower.jpg', alt: 'Higher or Lower' },
  { href: '/learning/trivia', img: '/Trivia.png', alt: 'Trivia' },
]

export default function Sidebar({ isOpen, onClose, user, checked, onLogout, topOffset = 0 }) {
  const { t, language } = useLanguage()
  const { openFeedback } = useFeedback()
  const isRtl = language === 'ar'
  const [expanded, setExpanded] = useState(null) // 'learn' | 'games' | null

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

  // Collapse any open accordion whenever the sidebar itself closes
  useEffect(() => {
    if (!isOpen) setExpanded(null)
  }, [isOpen])

  const sideClass = isRtl ? 'right-0 border-l' : 'left-0 border-r'
  const hiddenTranslate = isRtl ? 'translate-x-full' : '-translate-x-full'
  const displayName = user?.email ? user.email.split('@')[0] : null

  const imageButtonClass =
    'block w-full rounded-xl overflow-hidden transform transition duration-200 hover:scale-105'

  function toggleExpanded(key) {
    setExpanded((prev) => (prev === key ? null : key))
  }

  function AppLink({ href, img, alt }) {
    return (
      <Link
        href={href}
        onClick={onClose}
        className="block w-1/2 mx-auto rounded-lg overflow-hidden bg-black transform transition duration-200 hover:scale-105"
      >
        <img src={img} alt={alt} className="w-full h-12 object-contain" />
      </Link>
    )
  }

  return (
    <>
      {/* Backdrop - click to close. Starts below the navbar. */}
      <div
        onClick={onClose}
        style={{ top: topOffset }}
        className={`fixed inset-x-0 bottom-0 bg-black/50 z-40 transition-opacity ${
          isOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
        aria-hidden="true"
      />

      {/* Panel - starts below the navbar */}
      <aside
        style={{ top: topOffset, height: `calc(100% - ${topOffset}px)` }}
        className={`fixed w-64 bg-black border-zinc-800 z-40
          flex flex-col justify-between px-4 py-6 text-sm overflow-y-auto
          transform transition-transform duration-300 ease-in-out
          ${sideClass}
          ${isOpen ? 'translate-x-0' : hiddenTranslate}`}
        aria-hidden={!isOpen}
      >
        <div className="flex flex-col gap-4">
          {/* Welcome greeting */}
          {checked && displayName && (
            <p
              style={{ fontFamily: "'Caveat', cursive" }}
              className="text-gray-400 lowercase text-2xl tracking-tight border-b border-zinc-800 pb-4"
            >
              {t.nav.welcome(displayName)}
            </p>
          )}

          {/* Learn - expands to show sub-apps */}
          <div>
            <button onClick={() => toggleExpanded('learn')} className={imageButtonClass}>
              <img src="/Learn.jpg" alt={t.nav.learning} className="w-full h-auto block" />
            </button>
            <div
              className="grid transition-all duration-300 ease-in-out"
              style={{ gridTemplateRows: expanded === 'learn' ? '1fr' : '0fr' }}
            >
              <div className="overflow-hidden">
                <div className="flex flex-col gap-3 pt-3">
                  {LEARNING_APPS.map((app) => (
                    <AppLink key={app.href} {...app} />
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Entertain - expands to show sub-apps */}
          <div>
            <button onClick={() => toggleExpanded('games')} className={imageButtonClass}>
              <img src="/Entertain.jpg" alt={t.nav.games} className="w-full h-auto block" />
            </button>
            <div
              className="grid transition-all duration-300 ease-in-out"
              style={{ gridTemplateRows: expanded === 'games' ? '1fr' : '0fr' }}
            >
              <div className="overflow-hidden">
                <div className="flex flex-col gap-3 pt-3">
                  {GAME_APPS.map((app) => (
                    <AppLink key={app.href} {...app} />
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Socialise - plain link, no sub-apps yet */}
          <Link href="/socialise" onClick={onClose} className={imageButtonClass}>
            <img src="/Socialise.jpg" alt="Socialise" className="w-full h-auto block" />
          </Link>
        </div>

        {/* Bottom: about, feedback, username, logout (or login/signup) */}
        <div className="flex flex-col gap-4 border-t border-zinc-800 pt-4">
          <Link
            href="/about"
            onClick={onClose}
            className="text-blue-200 hover:text-sky-300 transition"
          >
            {t.nav.about}
          </Link>

          <button
            onClick={() => {
              openFeedback()
              onClose()
            }}
            className="text-left text-blue-200 hover:text-sky-300 transition"
          >
            {t.game.feedbackPrompt}
          </button>

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
