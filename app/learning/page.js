'use client'

import Link from 'next/link'
import { useLanguage } from '@/context/LanguageContext'

export default function LearningHubPage() {
  const { t } = useLanguage()

  return (
    <div className="flex-1 bg-zinc-950 text-zinc-100 flex flex-col items-center gap-8 px-6 py-16">
      <h1 className="font-serif text-3xl text-sky-300">{t.learningHub.title}</h1>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full max-w-2xl">
        <Link
          href="/learning/german"
          className="bg-blue-900/40 hover:bg-blue-900/60 border border-blue-700/40 rounded-2xl p-6 flex flex-col gap-2 transition"
        >
          <span className="text-3xl">🇩🇪</span>
          <span className="font-medium text-blue-100">{t.learningHub.german}</span>
          <span className="text-xs text-blue-300">{t.learningHub.germanDesc}</span>
        </Link>

        <Link
          href="/learning/trivia"
          className="bg-blue-900/40 hover:bg-blue-900/60 border border-blue-700/40 rounded-2xl p-6 flex flex-col gap-2 transition"
        >
          <span className="text-3xl">🧠</span>
          <span className="font-medium text-blue-100">{t.learningHub.trivia}</span>
          <span className="text-xs text-blue-300">{t.learningHub.triviaDesc}</span>
        </Link>

        <div className="bg-blue-900/10 border border-blue-700/20 rounded-2xl p-6 flex flex-col gap-2 opacity-50 cursor-not-allowed">
          <span className="text-3xl">＋</span>
          <span className="font-medium text-blue-100">{t.learningHub.comingSoon}</span>
        </div>
      </div>
    </div>
  )
}
