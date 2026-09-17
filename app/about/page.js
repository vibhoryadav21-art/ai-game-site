'use client'

import { useLanguage } from '@/context/LanguageContext'

export default function AboutPage() {
  const { t } = useLanguage()

  return (
    <div className="flex-1 bg-zinc-950 text-zinc-100 flex items-center justify-center px-6">
      <p className="text-zinc-500">{t.about.comingSoon}</p>
    </div>
  )
}
