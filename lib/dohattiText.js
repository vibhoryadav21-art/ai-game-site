'use client'

import { useLanguage } from '@/context/LanguageContext'
import { dohattiTranslations } from '@/lib/dohattiTranslations'

// Returns the game texts in the language chosen on the site.
//   t(...)  texts, any missing key falls back to English
//   tr(msg) translates a message that came from the server (falls back to the English text)
export function useDohattiText() {
  const { language } = useLanguage()
  const t = { ...dohattiTranslations.en, ...(dohattiTranslations[language] || {}) }
  const tr = (message) => (message && t.errors[message]) || message
  return { t, tr, language }
}
