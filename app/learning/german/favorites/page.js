'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabaseClient'
import { useLanguage } from '@/context/LanguageContext'
import GermanPractice from '@/components/GermanPractice'

export default function GermanFavoritesPage() {
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

    async function loadStats() {
      const { data, error } = await supabase
        .from('german_stats')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle()

      if (error) {
        console.error('Failed to load german_stats:', error.message)
      } else {
        setStats(data)
      }
      setLoadingStats(false)
    }

    loadStats()
  }, [checked, user])

  if (!checked || loadingStats) {
    return (
      <div className="flex-1 bg-black text-zinc-100 flex items-center justify-center">
        <p className="text-zinc-400">{t.practice.loading}</p>
      </div>
    )
  }

  if (!user) {
    return (
      <div className="flex-1 bg-black text-zinc-100 flex flex-col items-center justify-center gap-4 p-6 text-center">
        <p className="text-zinc-300">{t.practice.needAccount}</p>
        <div className="flex gap-3">
          <Link
            href="/login?redirect=/learning/german/favorites"
            className="px-5 py-2 rounded-lg border border-zinc-700 text-zinc-200 hover:border-sky-400 transition"
          >
            {t.nav.login}
          </Link>
          <Link
            href="/signup?redirect=/learning/german/favorites"
            className="px-5 py-2 rounded-lg bg-sky-500 hover:bg-sky-400 text-zinc-950 font-medium transition"
          >
            {t.nav.signup}
          </Link>
        </div>
      </div>
    )
  }

  // Favorites only make sense once someone has actually placed and started
  // practicing — send them through the normal flow first if they haven't.
  if (!stats?.placement_completed) {
    return (
      <div className="flex-1 bg-black text-zinc-100 flex flex-col items-center justify-center gap-4 p-6 text-center">
        <p className="text-zinc-300">{t.practice.finishPlacementFirst}</p>
        <Link
          href="/learning/german"
          className="px-5 py-2 rounded-lg bg-sky-500 hover:bg-sky-400 text-zinc-950 font-medium transition"
        >
          {t.practice.goToPlacement}
        </Link>
      </div>
    )
  }

  return (
    <GermanPractice user={user} stats={stats} onStatsChange={setStats} lockFavoritesOnly />
  )
}
