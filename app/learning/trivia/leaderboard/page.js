'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabaseClient'

const BADGES = [
  { min: 0, name: 'Beginner' },
  { min: 30, name: 'Challenger' },
  { min: 60, name: 'Advanced' },
  { min: 90, name: 'Pro' },
  { min: 120, name: 'QuizMaster' },
]

function getBadge(score) {
  let badge = BADGES[0].name
  for (const tier of BADGES) {
    if (score >= tier.min) badge = tier.name
  }
  return badge
}

export default function TriviaLeaderboardPage() {
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
        .from('trivia_stats')
        .select('user_id, display_name, score, total_answered, total_correct')

      if (error) {
        console.error('Failed to load leaderboard:', error.message)
        setLoading(false)
        return
      }

      const ranked = (data || [])
        .filter((r) => r.total_answered > 0)
        .map((r) => ({
          ...r,
          score: r.score || 0,
          accuracy: r.total_answered > 0 ? r.total_correct / r.total_answered : 0,
        }))
        .sort((a, b) => b.score - a.score || b.accuracy - a.accuracy)

      setRows(ranked)
      setLoading(false)
    }
    load()
  }, [])

  if (!checked || loading) {
    return (
      <div className="flex-1 bg-zinc-950 text-zinc-100 flex items-center justify-center">
        <p className="text-zinc-400">Loading…</p>
      </div>
    )
  }

  if (!user) {
    return (
      <div className="flex-1 bg-zinc-950 text-zinc-100 flex items-center justify-center">
        <p className="text-zinc-300">Log in to see the leaderboard.</p>
      </div>
    )
  }

  return (
    <div className="flex-1 bg-zinc-950 text-zinc-100 flex flex-col items-center gap-6 p-6">
      <div className="w-full max-w-lg flex items-center justify-between">
        <h1 className="font-serif text-2xl text-sky-300">Leaderboard</h1>
        <Link href="/learning/trivia" className="text-xs text-zinc-400 hover:text-sky-300 transition">
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
                  ? 'bg-sky-500/10 border-sky-500/40'
                  : 'bg-zinc-900 border-zinc-800'
              }`}
            >
              <div className="flex items-center gap-3">
                <span className="text-zinc-500 text-sm w-6">#{i + 1}</span>
                <span className={isYou ? 'text-sky-300 font-medium' : 'text-zinc-100'}>
                  {r.display_name} {isYou && '(you)'}
                </span>
                <span className="text-xs text-zinc-500 border border-zinc-700 rounded-full px-2 py-0.5">
                  {getBadge(r.score)}
                </span>
              </div>
              <span className="text-sm text-zinc-300">
                {r.score} pts{' '}
                <span className="text-zinc-500">
                  ({Math.round(r.accuracy * 100)}% of {r.total_answered})
                </span>
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
