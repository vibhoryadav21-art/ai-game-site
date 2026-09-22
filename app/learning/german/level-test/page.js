'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabaseClient'
import { useLanguage } from '@/context/LanguageContext'
import GermanLevelTest from '@/components/GermanLevelTest'

export default function GermanLevelTestPage() {
  const { t } = useLanguage()
  const [checked, setChecked] = useState(false)
  const [user, setUser] = useState(null)
  const [stats, setStats] = useState(null)
  const [loadingStats, setLoadingStats] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null)
      setChecked(true)
    })
  }, [])

  useEffect(() => {
    if (!checked) return
    if (!user) {
      setLoadingStats(false)
      return
    }
    supabase
      .from('german_stats')
      .select('*')
      .eq('user_id', user.id)
      .single()
      .then(({ data, error }) => {
        if (error) console.error('Failed to load stats:', error.message)
        setStats(data)
        setLoadingStats(false)
      })
  }, [checked, user])

  if (!checked || loadingStats) {
    return (
      <div className="flex-1 bg-black text-zinc-100 flex items-center justify-center">
        <p className="text-zinc-400">{t.levelTestPage.loading}</p>
      </div>
    )
  }

  if (!user) {
    return (
      <div className="flex-1 bg-black text-zinc-100 flex flex-col items-center justify-center gap-4 p-6 text-center">
        <p className="text-zinc-300">{t.levelTestPage.loginPrompt}</p>
        <Link
          href="/login?redirect=/learning/german/level-test"
          className="px-5 py-2 rounded-lg bg-sky-500 hover:bg-sky-400 text-zinc-950 font-medium transition"
        >
          {t.nav.login}
        </Link>
      </div>
    )
  }

  if (!stats) return null

  return (
    <GermanLevelTest
      user={user}
      stats={stats}
      onPassed={() => {}}
    />
  )
}
