'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabaseClient'
import { useLanguage } from '@/context/LanguageContext'
import GermanPlacementTest from '@/components/GermanPlacementTest'
import GermanPractice from '@/components/GermanPractice'

export default function GermanGamePage() {
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

    async function loadOrCreateStats() {
      const { data, error } = await supabase
        .from('german_stats')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle()

      if (error) {
        console.error('Failed to load german_stats:', error.message)
        setLoadingStats(false)
        return
      }

      if (data) {
        setStats(data)
      } else {
        const displayName = user.user_metadata?.full_name || user.email.split('@')[0]
        const { data: created, error: insertError } = await supabase
          .from('german_stats')
          .insert({ user_id: user.id, display_name: displayName })
          .select()
          .single()

        if (insertError) {
          console.error('Failed to create german_stats row:', insertError.message)
        } else {
          setStats(created)
        }
      }
      setLoadingStats(false)
    }

    loadOrCreateStats()
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
            href="/login?redirect=/learning/german"
            className="px-5 py-2 rounded-lg border border-zinc-700 text-zinc-200 hover:border-sky-400 transition"
          >
            {t.nav.login}
          </Link>
          <Link
            href="/signup?redirect=/learning/german"
            className="px-5 py-2 rounded-lg bg-sky-500 hover:bg-sky-400 text-zinc-950 font-medium transition"
          >
            {t.nav.signup}
          </Link>
        </div>
      </div>
    )
  }

  if (!stats?.placement_completed) {
    return (
      <GermanPlacementTest
        user={user}
        onComplete={(result) =>
          setStats((s) => ({
            ...s,
            placement_completed: true,
            current_level: result.determinedLevel,
            score: result.finalScore,
            total_answered: result.totalQuestions,
            total_correct: result.totalCorrect,
            level_stats: result.levelStats,
          }))
        }
      />
    )
  }

  // Practice screen — placement is done.
  return <GermanPractice user={user} stats={stats} onStatsChange={setStats} />
}
