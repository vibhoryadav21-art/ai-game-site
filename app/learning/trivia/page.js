'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabaseClient'
import TriviaPractice from '@/components/TriviaPractice'

export default function TriviaGamePage() {
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
        .from('trivia_stats')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle()

      if (error) {
        console.error('Failed to load trivia_stats:', error.message)
        setLoadingStats(false)
        return
      }

      if (data) {
        setStats(data)
      } else {
        const displayName = user.user_metadata?.full_name || user.email.split('@')[0]
        const { data: created, error: insertError } = await supabase
          .from('trivia_stats')
          .insert({ user_id: user.id, display_name: displayName })
          .select()
          .single()

        if (insertError) {
          console.error('Failed to create trivia_stats row:', insertError.message)
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
      <div className="flex-1 bg-zinc-950 text-zinc-100 flex items-center justify-center">
        <p className="text-zinc-400">Loading…</p>
      </div>
    )
  }

  if (!user) {
    return (
      <div className="flex-1 bg-zinc-950 text-zinc-100 flex flex-col items-center justify-center gap-4 p-6 text-center">
        <p className="text-zinc-300">You need an account to play this game.</p>
        <div className="flex gap-3">
          <Link
            href="/login?redirect=/learning/trivia"
            className="px-5 py-2 rounded-lg border border-zinc-700 text-zinc-200 hover:border-sky-400 transition"
          >
            Log in
          </Link>
          <Link
            href="/signup?redirect=/learning/trivia"
            className="px-5 py-2 rounded-lg bg-sky-500 hover:bg-sky-400 text-zinc-950 font-medium transition"
          >
            Sign up
          </Link>
        </div>
      </div>
    )
  }

  // Practice screen — no placement test, everyone starts at 0 points.
  return <TriviaPractice user={user} stats={stats} onStatsChange={setStats} />
}
