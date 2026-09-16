'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabaseClient'
import GermanPlacementTest from '@/components/GermanPlacementTest'

export default function GermanGamePage() {
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
      <div className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center">
        <p className="text-zinc-400">Loading…</p>
      </div>
    )
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col items-center justify-center gap-4 p-6 text-center">
        <p className="text-zinc-300">You need an account to play this game.</p>
        <div className="flex gap-3">
          <Link
            href="/login"
            className="px-5 py-2 rounded-lg border border-zinc-700 text-zinc-200 hover:border-amber-400 transition"
          >
            Log in
          </Link>
          <Link
            href="/signup"
            className="px-5 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-zinc-950 font-medium transition"
          >
            Sign up
          </Link>
        </div>
      </div>
    )
  }

  if (!stats?.placement_completed) {
    return (
      <GermanPlacementTest
        user={user}
        onComplete={(level) => setStats((s) => ({ ...s, placement_completed: true, current_level: level }))}
      />
    )
  }

  // Practice screen comes next — placement is done, so this is a
  // placeholder until that's built.
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col items-center justify-center gap-4">
      <p className="text-zinc-400">Your level: <span className="text-amber-300">{stats.current_level}</span></p>
      <p className="text-zinc-500 text-sm">Practice screen coming in the next step.</p>
    </div>
  )
}
