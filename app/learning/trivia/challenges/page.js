'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import { useLanguage } from '@/context/LanguageContext'

function statusLabel(c, userId) {
  const iAmChallenger = c.challenger_id === userId
  const expired = new Date(c.expires_at) < new Date()
  if (c.status === 'completed') return { text: 'Finished · see results', style: 'text-emerald-300' }
  if (c.status === 'declined') return { text: 'Declined', style: 'text-zinc-500' }
  if (expired) return { text: 'Expired', style: 'text-zinc-500' }
  if (c.status === 'pending') {
    return iAmChallenger
      ? { text: 'Waiting for them to accept', style: 'text-zinc-400' }
      : { text: 'Wants to challenge you!', style: 'text-sky-300' }
  }
  return { text: 'In progress', style: 'text-amber-300' }
}

export default function ChallengesPage() {
  const { language } = useLanguage()
  const router = useRouter()

  const [checked, setChecked] = useState(false)
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  const [crewId, setCrewId] = useState(null)
  const [mateIds, setMateIds] = useState([])
  const [names, setNames] = useState({})
  const [challenges, setChallenges] = useState([])
  const [topics, setTopics] = useState([])

  const [opponent, setOpponent] = useState('')
  const [topic, setTopic] = useState('all')
  const [count, setCount] = useState(10)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')

  // 1. Who is logged in?
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null)
      setChecked(true)
    })
  }, [])

  // 2. Load crew mates + all my challenges
  useEffect(() => {
    if (!checked) return
    if (!user) {
      setLoading(false)
      return
    }

    async function loadAll() {
      // My default crew (same field the trivia page already uses)
      const { data: me } = await supabase
        .from('trivia_stats')
        .select('default_crew_id')
        .eq('user_id', user.id)
        .maybeSingle()
      const cid = me?.default_crew_id ?? null
      setCrewId(cid)

      // Crew mates
      let mates = []
      if (cid) {
        const { data: members } = await supabase
          .from('crew_members')
          .select('user_id')
          .eq('crew_id', cid)
          .eq('status', 'member')
          .neq('user_id', user.id)
        mates = (members || []).map((m) => m.user_id)
      }
      setMateIds(mates)

      // My challenges (row level security already limits this to mine)
      const { data: chs, error: chError } = await supabase
        .from('challenges')
        .select('*')
        .order('created_at', { ascending: false })
      if (chError) console.error('Failed to load challenges:', chError.message)
      const list = chs || []
      setChallenges(list)

      // Display names for everyone involved
      const ids = new Set(mates)
      list.forEach((c) => {
        ids.add(c.challenger_id)
        ids.add(c.opponent_id)
      })
      if (ids.size > 0) {
        const { data: people } = await supabase
          .from('trivia_stats')
          .select('user_id, display_name')
          .in('user_id', [...ids])
        setNames(Object.fromEntries((people || []).map((p) => [p.user_id, p.display_name])))
      }
      setLoading(false)
    }

    loadAll()
  }, [checked, user])

  // 3. Topics for the dropdown (questions are tagged by language)
  useEffect(() => {
    async function loadTopics() {
      const { data } = await supabase
        .from('trivia_questions')
        .select('topic')
        .eq('language', language)
      const unique = [...new Set((data || []).map((d) => d.topic).filter(Boolean))].sort((a, b) =>
        a.localeCompare(b)
      )
      setTopics(unique)
      setTopic('all')
    }
    loadTopics()
  }, [language])

  async function sendChallenge() {
    if (!opponent) return
    setSending(true)
    setError('')

    const { data: challengeId, error: rpcError } = await supabase.rpc('create_challenge', {
      p_opponent: opponent,
      p_language: language,
      p_topic: topic === 'all' ? null : topic,
      p_count: count,
    })

    setSending(false)

    if (rpcError) {
      console.error('Failed to create challenge:', rpcError.message)
      if (rpcError.message.includes('Not enough questions')) {
        setError('Not enough questions for that topic. Pick "All topics" or fewer questions.')
      } else {
        setError("Couldn't send the challenge. Try again.")
      }
      return
    }

    router.push(`/learning/trivia/challenges/${challengeId}`)
  }

  if (!checked || loading) {
    return (
      <div className="flex-1 bg-black text-zinc-100 flex items-center justify-center">
        <p className="text-zinc-400">Loading…</p>
      </div>
    )
  }

  if (!user) {
    return (
      <div className="flex-1 bg-black text-zinc-100 flex flex-col items-center justify-center gap-4 p-6 text-center">
        <p className="text-zinc-300">Log in to challenge your crew.</p>
        <div className="flex gap-3">
          <Link
            href="/login?redirect=/learning/trivia/challenges"
            className="px-5 py-2 rounded-lg border border-zinc-700 text-zinc-200 hover:border-sky-400 transition"
          >
            Log in
          </Link>
          <Link
            href="/signup?redirect=/learning/trivia/challenges"
            className="px-5 py-2 rounded-lg bg-sky-500 hover:bg-sky-400 text-zinc-950 font-medium transition"
          >
            Sign up
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 bg-black text-zinc-100 flex flex-col items-center gap-6 p-6">
      <div className="w-full max-w-md flex items-center justify-between">
        <h1 className="text-xl">Challenges</h1>
        <Link
          href="/learning/trivia"
          className="text-xs text-sky-300 hover:text-sky-200 transition"
        >
          Back to practice
        </Link>
      </div>

      {/* Start a new challenge */}
      <div className="w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-xl p-4 flex flex-col gap-3">
        <p className="text-sm text-zinc-300">Challenge a crew mate</p>

        {!crewId && (
          <p className="text-xs text-zinc-500">
            <Link href="/learning/trivia/leaderboard" className="text-sky-300 hover:text-sky-200 transition">
              Pick a crew
            </Link>{' '}
            first. You can challenge people in your crew.
          </p>
        )}

        {crewId && mateIds.length === 0 && (
          <p className="text-xs text-zinc-500">
            No one else is in your crew yet. Invite a friend to join it.
          </p>
        )}

        {crewId && mateIds.length > 0 && (
          <>
            <select
              value={opponent}
              onChange={(e) => setOpponent(e.target.value)}
              className="bg-zinc-900 border border-zinc-700 text-zinc-200 text-sm rounded-lg px-2 py-2 focus:outline-none focus:border-sky-400"
            >
              <option value="">Choose a player</option>
              {mateIds.map((id) => (
                <option key={id} value={id}>
                  {names[id] || 'Someone'}
                </option>
              ))}
            </select>

            <div className="flex gap-2">
              <select
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                className="flex-1 bg-zinc-900 border border-zinc-700 text-zinc-200 text-sm rounded-lg px-2 py-2 focus:outline-none focus:border-sky-400"
              >
                <option value="all">All topics</option>
                {topics.map((tp) => (
                  <option key={tp} value={tp}>
                    {tp}
                  </option>
                ))}
              </select>

              <select
                value={count}
                onChange={(e) => setCount(Number(e.target.value))}
                className="bg-zinc-900 border border-zinc-700 text-zinc-200 text-sm rounded-lg px-2 py-2 focus:outline-none focus:border-sky-400"
              >
                <option value={5}>5 questions</option>
                <option value={10}>10 questions</option>
                <option value={15}>15 questions</option>
                <option value={20}>20 questions</option>
                <option value={25}>25 questions</option>
                <option value={30}>30 questions</option>
              </select>
            </div>

            <button
              onClick={sendChallenge}
              disabled={!opponent || sending}
              className="bg-sky-500 hover:bg-sky-400 disabled:opacity-40 text-zinc-950 font-medium px-6 py-2 rounded-xl transition"
            >
              {sending ? 'Sending…' : 'Send challenge'}
            </button>
            {error && <p className="text-xs text-rose-300">{error}</p>}
          </>
        )}
      </div>

      {/* Existing challenges */}
      <div className="w-full max-w-md flex flex-col gap-2">
        {challenges.length === 0 && (
          <p className="text-xs text-zinc-500 text-center">
            No challenges yet. Send one to a crew mate to get started.
          </p>
        )}

        {challenges.map((c) => {
          const otherId = c.challenger_id === user.id ? c.opponent_id : c.challenger_id
          const label = statusLabel(c, user.id)
          return (
            <Link
              key={c.id}
              href={`/learning/trivia/challenges/${c.id}`}
              className="flex items-center justify-between gap-3 rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3 hover:border-sky-400 transition"
            >
              <div className="flex flex-col">
                <span className="text-sm text-zinc-100">vs {names[otherId] || 'Someone'}</span>
                <span className="text-[11px] text-zinc-500">
                  {c.question_ids.length} questions{c.topic ? ` · ${c.topic}` : ''}
                </span>
              </div>
              <span className={`text-xs ${label.style}`}>{label.text}</span>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
