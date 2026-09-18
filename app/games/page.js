'use client'

import Link from 'next/link'
import { useLanguage } from '@/context/LanguageContext'

export default function GamesHubPage() {
  const { t } = useLanguage()

  return (
    <div className="flex-1 bg-black text-zinc-100 flex flex-col items-center gap-8 px-6 py-16">
      <h1 className="font-serif text-3xl text-sky-300">{t.games.title}</h1>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full max-w-2xl">
        <Link
          href="/game"
          className="bg-emerald-900 hover:bg-emerald-800 border border-emerald-700/40 rounded-2xl p-6 flex flex-col gap-2 transition"
        >
          <span className="text-3xl">🂡</span>
          <span className="font-medium text-emerald-100">{t.games.higherLower}</span>
          <span className="text-xs text-emerald-300">{t.games.higherLowerDesc}</span>
        </Link>

        <div className="bg-emerald-900/40 border border-emerald-700/20 rounded-2xl p-6 flex flex-col gap-2 opacity-50 cursor-not-allowed">
          <span className="text-3xl">🂮</span>
          <span className="font-medium text-emerald-100">{t.games.doHatti}</span>
          <span className="text-xs text-emerald-300">{t.games.doHattiDesc}</span>
          <span className="text-[10px] uppercase tracking-wide text-sky-400 mt-1">
            {t.games.comingSoon}
          </span>
        </div>
      </div>
    </div>
  )
}
