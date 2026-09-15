'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useLanguage } from '@/context/LanguageContext'

// Purely decorative — cycles through greetings regardless of the site's
// selected language, as a "welcome, wherever you're from" gesture.
const GREETINGS = [
  'Welcome',
  'Willkommen',
  'أهلاً وسهلاً',
  'Bienvenue',
  'Bienvenido',
  '欢迎',
  'स्वागत है',
]

function RotatingGreeting() {
  const [index, setIndex] = useState(0)
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    const interval = setInterval(() => {
      setVisible(false)
      setTimeout(() => {
        setIndex((i) => (i + 1) % GREETINGS.length)
        setVisible(true)
      }, 300)
    }, 2200)
    return () => clearInterval(interval)
  }, [])

  return (
    <h1
      className={`font-serif text-5xl text-amber-300 text-center transition-opacity duration-300 ${
        visible ? 'opacity-100' : 'opacity-0'
      }`}
    >
      {GREETINGS[index]}
    </h1>
  )
}

export default function HomePage() {
  const { t } = useLanguage()

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col items-center justify-center gap-12 px-6 py-20">
      <div className="flex flex-col items-center gap-4 text-center">
        <RotatingGreeting />
        <p className="text-zinc-400 max-w-md">{t.home.tagline}</p>
        <Link
          href="/games"
          className="mt-2 bg-amber-500 hover:bg-amber-400 text-zinc-950 font-medium px-8 py-3 rounded-xl transition"
        >
          {t.home.cta}
        </Link>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 w-full max-w-3xl">
        <Link
          href="/games"
          className="bg-emerald-800/60 hover:bg-emerald-800 border border-emerald-600/40 rounded-2xl p-6 flex flex-col gap-2 transition"
        >
          <span className="text-2xl">♠ ♥</span>
          <span className="font-medium text-emerald-100">{t.home.cardGames}</span>
          <span className="text-xs text-emerald-300">{t.home.cardGamesDesc}</span>
        </Link>

        <div className="bg-blue-900/20 border border-blue-700/20 rounded-2xl p-6 flex flex-col gap-2 opacity-50 cursor-not-allowed">
          <span className="text-2xl">♟</span>
          <span className="font-medium text-blue-100">{t.home.boardGames}</span>
          <span className="text-xs text-blue-300">{t.home.comingSoon}</span>
        </div>

        <div className="bg-purple-900/20 border border-purple-700/20 rounded-2xl p-6 flex flex-col gap-2 opacity-50 cursor-not-allowed">
          <span className="text-2xl">🕹</span>
          <span className="font-medium text-purple-100">{t.home.arcade}</span>
          <span className="text-xs text-purple-300">{t.home.comingSoon}</span>
        </div>
      </div>
    </div>
  )
}
