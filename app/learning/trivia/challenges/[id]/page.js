'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'

export default function ChallengePlayPage() {
  const { id } = useParams()

  const [checked, setChecked] = useState(false)
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  const [challenge, setChallenge] = useState(null)
  const [questions, setQuestions] = useState([]) // in the frozen order
  const [answeredIds, setAnsweredIds] = useState([]) // question ids I've already answered
  const [names, setNames] = useState({})
  const [results, setResults] = useState(null) // null = not loaded, [] = opponent not finished

  const [selected, setSelected] = useState(null)
  const [correctOption, setCorrectOption] = useState(null)
  const [error, setError] = useState('')
  const questionStartRef = useRef(Date.now())

  // 1. Who is logged in?
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null)
      setChecked(true)
    })
  }, [])

  // 2. Load the challenge, its questions, and what I've answered so far
  const loadChallenge = useCallback(async (userId) => {
    const { data: ch, error: chError } = await supabase
      .from('challenges')
      .select('*')
      .eq('id', id)
      .maybeSingle()

    if (chError || !ch) {
      setNotFound(true)
      setLoading(false)
      return
    }
    setChallenge(ch)

    // Never ask for correct_option here. The server checks answers.
    const { data: qs } = await supabase
      .from('trivia_questions')
      .select('id, question, option_a, option_b, option_c, option_d')
      .in('id', ch.question_ids)
    const ordered = ch.question_ids
      .map((qid) => (qs || []).find((q) => String(q.id) === qid))
      .filter(Boolean)
    setQuestions(ordered)

    const { data: mine } = await supabase
      .from('challenge_answers')
      .select('question_id')
      .eq('challenge_id', id)
      .eq('user_id', userId)
    setAnsweredIds((mine || []).map((a) => a.question_id))

    const { data: people } = await supabase
      .from('trivia_stats')
      .select('user_id, display_name')
      .in('user_id', [ch.challenger_id, ch.opponent_id])
    setNames(Object.fromEntries((people || []).map((p) => [p.user_id, p.display_name])))

    setLoading(false)
  }, [id])

  useEffect(() => {
    if (!checked) return
    if (!user) {
      setLoading(false)
      return
    }
    loadChallenge(user.id)
  }, [checked, user, loadChallenge])

  const finished = questions.length > 0 && answeredIds.length >= questions.length
  const current = questions.find((q) => !answeredIds.includes(String(q.id)))

  // Restart the per-question timer whenever a new question appears
  useEffect(() => {
    questionStartRef.current = Date.now()
  }, [current?.id])

  // 3. Once I'm finished, check for results every few seconds until my opponent is done too
  useEffect(() => {
    if (!finished) return
    let cancelled = false
    let timer

    async function poll() {
      const { data, error: rpcError } = await supabase.rpc('get_challenge_results', {
        p_challenge: id,
      })
      if (cancelled || rpcError) return
      setResults(data || [])
      if (data && data.length > 0 && timer) clearInterval(timer)
    }

    poll()
    timer = setInterval(poll, 8000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [finished, id])

  async function respond(accept) {
    setError('')
    const { error: rpcError } = await supabase.rpc('respond_to_challenge', {
      p_challenge: id,
      p_accept: accept,
    })
    if (rpcError) {
      console.error('Failed to respond:', rpcError.message)
      setError("Couldn't update the challenge. It may have expired.")
      return
    }
    setChallenge((c) => ({ ...c, status: accept ? 'accepted' : 'declined' }))
  }

  async function handleSelect(optionKey) {
    if (selected || !current) return
    setSelected(optionKey)
    setError('')

    const elapsed = Date.now() - questionStartRef.current
    const { data, error: rpcError } = await supabase.rpc('submit_challenge_answer', {
      p_challenge: id,
      p_question: String(current.id),
      p_selected: optionKey,
      p_time_ms: elapsed,
    })

    if (rpcError) {
      console.error('Failed to save answer:', rpcError.message)
      setError("Couldn't save your answer. Try again.")
      setSelected(null)
      return
    }
    setCorrectOption(data) // 'a' | 'b' | 'c' | 'd'
  }

  function handleNext() {
    setAnsweredIds((prev) => [...prev, String(current.id)])
    setSelected(null)
    setCorrectOption(null)
  }

  const shell = 'flex-1 bg-black text-zinc-100 flex flex-col items-center justify-center gap-4 p-6 text-center'
  const backLink = (
    <Link href="/learning/trivia/challenges" className="text-xs text-sky-300 hover:text-sky-200 transition">
      Back to challenges
    </Link>
  )

  if (!checked || loading) {
    return (
      <div className="flex-1 bg-black text-zinc-100 flex items-center justify-center">
        <p className="text-zinc-400">Loading…</p>
      </div>
    )
  }

  if (!user) {
    return (
      <div className={shell}>
        <p className="text-zinc-300">Log in to play this challenge.</p>
        <Link
          href={`/login?redirect=/learning/trivia/challenges/${id}`}
          className="px-5 py-2 rounded-lg bg-sky-500 hover:bg-sky-400 text-zinc-950 font-medium transition"
        >
          Log in
        </Link>
      </div>
    )
  }

  if (notFound || !challenge) {
    return (
      <div className={shell}>
        <p className="text-zinc-300">We couldn't find this challenge. It may not be yours.</p>
        {backLink}
      </div>
    )
  }

  const iAmOpponent = challenge.opponent_id === user.id
  const otherId = iAmOpponent ? challenge.challenger_id : challenge.opponent_id
  const otherName = names[otherId] || 'Your opponent'
  const expired = new Date(challenge.expires_at) < new Date()

  // ---- Results (both players finished) ----
  if (results && results.length > 0) {
    const mine = results.find((r) => r.user_id === user.id)
    const theirs = results.find((r) => r.user_id !== user.id)
    const myScore = mine ? Number(mine.score) : 0
    const theirScore = theirs ? Number(theirs.score) : 0
    const myTime = mine ? Number(mine.total_time_ms) : 0
    const theirTime = theirs ? Number(theirs.total_time_ms) : 0

    let headline = "It's a draw!"
    let headlineStyle = 'text-zinc-200'
    let note = ''
    if (myScore !== theirScore) {
      const won = myScore > theirScore
      headline = won ? 'You won!' : `${otherName} won`
      headlineStyle = won ? 'text-emerald-300' : 'text-rose-300'
    } else if (myTime !== theirTime) {
      const won = myTime < theirTime
      headline = won ? 'You won!' : `${otherName} won`
      headlineStyle = won ? 'text-emerald-300' : 'text-rose-300'
      note = 'Same score, so the faster player wins.'
    }

    return (
      <div className={shell}>
        <p className={`text-2xl ${headlineStyle}`}>{headline}</p>
        {note && <p className="text-xs text-zinc-500">{note}</p>}

        <div className="grid grid-cols-2 gap-3 w-full max-w-md">
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
            <p className="text-xs text-zinc-400">You</p>
            <p className="text-2xl text-zinc-100">
              {myScore}/{questions.length}
            </p>
            <p className="text-[11px] text-zinc-500">{(myTime / 1000).toFixed(1)}s total</p>
          </div>
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
            <p className="text-xs text-zinc-400">{otherName}</p>
            <p className="text-2xl text-zinc-100">
              {theirScore}/{questions.length}
            </p>
            <p className="text-[11px] text-zinc-500">{(theirTime / 1000).toFixed(1)}s total</p>
          </div>
        </div>

        {backLink}
      </div>
    )
  }

  // ---- Declined ----
  if (challenge.status === 'declined') {
    return (
      <div className={shell}>
        <p className="text-zinc-300">
          {iAmOpponent ? 'You declined this challenge.' : `${otherName} declined this challenge.`}
        </p>
        {backLink}
      </div>
    )
  }

  // ---- I've answered everything, waiting for the other player ----
  if (finished) {
    return (
      <div className={shell}>
        <p className="text-zinc-200">You finished all {questions.length} questions.</p>
        <p className="text-sm text-zinc-400">
          {expired
            ? `This challenge expired before ${otherName} finished.`
            : challenge.status === 'pending'
              ? `Waiting for ${otherName} to accept and play. Results appear here when they're done.`
              : `Waiting for ${otherName} to finish. Results appear here when they're done.`}
        </p>
        {backLink}
      </div>
    )
  }

  // ---- Expired before I finished ----
  if (expired) {
    return (
      <div className={shell}>
        <p className="text-zinc-300">This challenge has expired.</p>
        {backLink}
      </div>
    )
  }

  // ---- Opponent still needs to accept ----
  if (iAmOpponent && challenge.status === 'pending') {
    return (
      <div className={shell}>
        <p className="text-xl text-zinc-100">{otherName} challenged you!</p>
        <p className="text-sm text-zinc-400">
          {questions.length} questions{challenge.topic ? ` about ${challenge.topic}` : ''}. You both
          get the same questions. Highest score wins, and the faster player wins a tie.
        </p>
        <div className="flex gap-3">
          <button
            onClick={() => respond(true)}
            className="bg-sky-500 hover:bg-sky-400 text-zinc-950 font-medium px-6 py-2 rounded-xl transition"
          >
            Accept
          </button>
          <button
            onClick={() => respond(false)}
            className="px-6 py-2 rounded-xl border border-zinc-700 text-zinc-200 hover:border-rose-400 transition"
          >
            Decline
          </button>
        </div>
        {error && <p className="text-xs text-rose-300">{error}</p>}
        {backLink}
      </div>
    )
  }

  // ---- Playing ----
  if (!current) {
    return (
      <div className={shell}>
        <p className="text-zinc-300">Some questions in this challenge are no longer available.</p>
        {backLink}
      </div>
    )
  }

  const options = [
    { key: 'a', text: current.option_a },
    { key: 'b', text: current.option_b },
    { key: 'c', text: current.option_c },
    { key: 'd', text: current.option_d },
  ]
  const answered = selected !== null && correctOption !== null
  const isLast = answeredIds.length + 1 >= questions.length

  return (
    <div className="flex-1 bg-black text-zinc-100 flex flex-col items-center justify-center gap-6 p-6">
      <p className="text-xs text-zinc-400">
        Challenge vs {otherName} · Question {answeredIds.length + 1} of {questions.length}
      </p>

      <p className="text-xl text-center max-w-md">{current.question}</p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full max-w-md">
        {options.map((opt) => {
          const isCorrectOption = answered && opt.key === correctOption
          const isWrongPick = answered && opt.key === selected && opt.key !== correctOption
          let style = 'bg-zinc-900 border-zinc-700 hover:bg-zinc-800'
          if (isCorrectOption) style = 'bg-emerald-900 border-emerald-500 text-emerald-100'
          else if (isWrongPick) style = 'bg-rose-950 border-rose-500 text-rose-100'
          return (
            <button
              key={opt.key}
              onClick={() => handleSelect(opt.key)}
              disabled={selected !== null}
              className={`border rounded-xl px-4 py-3 text-left transition ${style}`}
            >
              {opt.text}
            </button>
          )
        })}
      </div>

      {error && <p className="text-xs text-rose-300">{error}</p>}

      {answered && (
        <div className="flex flex-col items-center gap-3">
          <p className={selected === correctOption ? 'text-emerald-300' : 'text-rose-300'}>
            {selected === correctOption ? 'Correct!' : 'Not quite.'}
          </p>
          <button
            onClick={handleNext}
            className="bg-sky-500 hover:bg-sky-400 text-zinc-950 font-medium px-6 py-2 rounded-xl transition"
          >
            {isLast ? 'Finish' : 'Next question'}
          </button>
        </div>
      )}
    </div>
  )
}
