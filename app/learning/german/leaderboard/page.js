'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabaseClient'

export default function GermanLeaderboardPage() {
  const [checked, setChecked] = useState(false)
  const [user, setUser] = useState(null)
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null)
      setChecked(true)
    })
  }, [])

  useEffect(() => {
    async function load() {
      const { data, error } = await supabase
        .from('german_stats')
        .select('user_id, display_name, current_level, total_answered, total_correct')

      if (error) {
        console.error('Failed to load leaderboard:', error.message)
        setLoading(false)
        return
      }

      const ranked = (data || [])
        .filter((r) => r.total_answered > 0)
        .map((r) => ({ ...r, accuracy: r.total_correct / r.total_answered }))
        .sort((a, b) => b.accuracy - a.accuracy || b.total_answered - a.total_answered)

      setRows(ranked)
      setLoading(false)
    }
    load()
  }, [])

  if (!checked || loading) {
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center">
        <p className="text-zinc-400">Loading…</p>
      </div>
    )
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center">
        <p className="text-zinc-300">Log in to see the leaderboard.</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col items-center gap-6 p-6">
      <div className="w-full max-w-lg flex items-center justify-between">
        <h1 className="font-serif text-2xl text-amber-300">Leaderboard</h1>
        <Link href="/learning/german" className="text-xs text-zinc-400 hover:text-amber-300 transition">
          Back to practice
        </Link>
      </div>

      {rows.length === 0 && (
        <p className="text-zinc-500 text-sm">No one's answered any questions yet.</p>
      )}

      <div className="w-full max-w-lg flex flex-col gap-2">
        {rows.map((r, i) => {
          const isYou = r.user_id === user.id
          return (
            <div
              key={r.user_id}
              className={`flex items-center justify-between rounded-xl px-4 py-3 border ${
                isYou
                  ? 'bg-amber-500/10 border-amber-500/40'
                  : 'bg-zinc-900 border-zinc-800'
              }`}
            >
              <div className="flex items-center gap-3">
                <span className="text-zinc-500 text-sm w-6">#{i + 1}</span>
                <span className={isYou ? 'text-amber-300 font-medium' : 'text-zinc-100'}>
                  {r.display_name} {isYou && '(you)'}
                </span>
                <span className="text-xs text-zinc-500 border border-zinc-700 rounded-full px-2 py-0.5">
                  {r.current_level}
                </span>
              </div>
              <span className="text-sm text-zinc-300">
                {Math.round(r.accuracy * 100)}%{' '}
                <span className="text-zinc-500">
                  ({r.total_correct}/{r.total_answered})
                </span>
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
