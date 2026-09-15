'use client'

import { createContext, useContext, useEffect, useState } from 'react'
import { translations } from '@/lib/translations'

const LanguageContext = createContext(null)

export function LanguageProvider({ children }) {
  const [language, setLanguageState] = useState('en')

  // Restore a previously chosen language when the page loads.
  useEffect(() => {
    const saved = window.localStorage.getItem('language')
    if (saved && translations[saved]) {
      setLanguageState(saved)
    }
  }, [])

  // Keep the page's language/direction attributes in sync — this is what
  // makes Arabic lay out right-to-left automatically.
  useEffect(() => {
    document.documentElement.lang = language
    document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr'
  }, [language])

  function setLanguage(lang) {
    setLanguageState(lang)
    window.localStorage.setItem('language', lang)
  }

  const value = {
    language,
    setLanguage,
    t: translations[language],
  }

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>
}

export function useLanguage() {
  const context = useContext(LanguageContext)
  if (!context) {
    throw new Error('useLanguage must be used inside a LanguageProvider')
  }
  return context
}
