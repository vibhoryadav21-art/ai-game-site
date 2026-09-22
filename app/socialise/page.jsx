'use client'

import { useLanguage } from '@/context/LanguageContext'

export default function SocialisePage() {
  const { t } = useLanguage()

  return (
    <div className="min-h-[70vh] flex items-center justify-center px-6 text-center">
      <p className="text-blue-200 text-lg">{t.socialise.comingSoon}</p>
    </div>
  )
}
