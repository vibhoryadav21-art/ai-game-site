'use client'

import { createContext, useContext, useEffect, useState } from 'react'
import { translations } from '@/lib/translations'

// A real default shape (not null) — this is what fixes the TypeScript
// build error, since TS can now infer a proper object type here.
const defaultContextValue = {
  language: 'en',
  setLanguage: () => {},
  t: translations.en,
}

const LanguageContext = createContext(defaultContextValue)

export function LanguageProvider({ children }) {
  const [language, setLanguageState] = useState('en')

  useEffect(() => {
    const saved = window.localStorage.getItem('language')
    if (saved && translations[saved]) {
      setLanguageState(saved)
    }
  }, [])

  useEffect(() => {
    document.documentElement.lang = language
    document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr'
  }, [language])

  function setLanguage(lang) {
    setLanguageState(lang)
    window.localStorage.setItem('language', lang)
  }

  const value = { language, setLanguage, t: translations[language] }

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>
}

export function useLanguage() {
  return useContext(LanguageContext)
}
