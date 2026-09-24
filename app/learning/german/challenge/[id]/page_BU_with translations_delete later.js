'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import { useLanguage } from '@/context/LanguageContext'

export default function ChallengePage() {
  const { id: challengeId } = useParams()
  const { t } = useLanguage()
  const tc = t.crewChallenge

  const [checked, setChecked] = useState(false)
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [notAllowed, setNotAllowed] = useState(false)

  const [challenge, setChallenge] = useState(null)
  const [questions, setQuestions] = useState([]) // full question rows, in challenge order
  const [participant, setParticipant] = useState(null)

  const [currentIndex, setCurrentIndex] = useState(0)
  const [selected, setSelected] = useState(null)
  const [answered, setAnswered] = useState(false)
  const [tally, setTally] = useState({ correct: 0, wrong: 0, skipped: 0, score: 0 })

  const [view, setView] = useState('start') // start | playing | done | results
  const [results, setResults] = useState({ completed: [], waiting: [] })
  const [loadingResults, setLoadingResults] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null)
      setChecked(true)
    })
  }, [])

  const loadChallenge = useCallback(async (userId) => {
    setLoading(true)

    const { data: challengeRow, error: challengeError } = await supabase
      .from('crew_challenges')
      .select('*')
      .eq('id', challengeId)
      .single()

    if (challengeError || !challengeRow) {
      console.error('Failed to load challenge:', challengeError?.message)
      setNotAllowed(true)
      setLoading(false)
      return
    }

    const { data: membership } = await supabase
      .from('crew_members')
      .select('status')
      .eq('crew_id', challengeRow.crew_id)
      .eq('user_id', userId)
      .eq('status', 'member')
      .maybeSingle()

    if (!membership) {
      setNotAllowed(true)
      setLoading(false)
      return
    }

    setChallenge(challengeRow)

    const { data: questionRows } = await supabase
      .from('german_questions')
      .select('*')
      .in('id', challengeRow.question_ids)

    const byId = Object.fromEntries((questionRows || []).map((q) => [q.id, q]))
    setQuestions(challengeRow.question_ids.map((qid) => byId[qid]).filter(Boolean))

    const { data: participantRow } = await supabase
      .from('challenge_participants')
      .select('*')
      .eq('challenge_id', challengeId)
      .eq('user_id', userId)
      .maybeSingle()

    if (participantRow) {
      setParticipant(participantRow)
      setTally({
        correct: participantRow.correct_count,
        wrong: participantRow.wrong_count,
        skipped: participantRow.skipped_count,
        score: participantRow.score,
      })
      if (participantRow.status === 'completed') {
        setView('done')
      } else if (participantRow.status === 'in_progress') {
        // Resume where they left off — figure out how many answers are
        // already recorded for this attempt.
        const { data: existingAnswers } = await supabase
          .from('challenge_answers')
          .select('question_id')
          .eq('challenge_id', challengeId)
          .eq('user_id', userId)
        setCurrentIndex((existingAnswers || []).length)
        setView('playing')
      }
    }

    setLoading(false)
  }, [challengeId])

  useEffect(() => {
    if (checked && user) loadChallenge(user.id)
  }, [checked, user, loadChallenge])

  async function startChallenge() {
    const startedAt = new Date().toISOString()
    const { data: row, error } = await supabase
      .from('challenge_participants')
      .insert({
        challenge_id: challengeId,
        user_id: user.id,
        status: 'in_progress',
        started_at: startedAt,
      })
      .select()
      .single()

    if (error) {
      console.error('Failed to start challenge:', error.message)
      return
    }
    setParticipant(row)
    setCurrentIndex(0)
    setView('playing')
  }

  async function recordAnswer(optionKey) {
    if (answered) return
    const question = questions[currentIndex]
    const isSkip = optionKey === null
    const isCorrect = !isSkip && optionKey === question.correct_option
    const points = isSkip ? 0 : isCorrect ? 2 : -1

    setSelected(optionKey)
    setAnswered(true)

    setTally((prev) => ({
      correct: prev.correct + (isCorrect ? 1 : 0),
      wrong: prev.wrong + (!isSkip && !isCorrect ? 1 : 0),
      skipped: prev.skipped + (isSkip ? 1 : 0),
      score: prev.score + points,
    }))

    await supabase.from('challenge_answers').insert({
      challenge_id: challengeId,
      user_id: user.id,
      question_id: question.id,
      position: currentIndex,
      selected_option: optionKey,
      is_correct: isSkip ? null : isCorrect,
      points,
    })

    if (isSkip) {
      // No feedback to show for a skip — advance right away.
      goToNext()
    }
  }

  function goToNext() {
    if (currentIndex + 1 >= questions.length) {
      finishChallenge()
    } else {
      setCurrentIndex((i) => i + 1)
      setSelected(null)
      setAnswered(false)
    }
  }

  async function finishChallenge() {
    const finishedAt = new Date()
    const startedAt = new Date(participant.started_at)
    const timeTakenMs = finishedAt.getTime() - startedAt.getTime()

    setTally((current) => {
      supabase
        .from('challenge_participants')
        .update({
          status: 'completed',
          finished_at: finishedAt.toISOString(),
          correct_count: current.correct,
          wrong_count: current.wrong,
          skipped_count: current.skipped,
          score: current.score,
          time_taken_ms: timeTakenMs,
        })
        .eq('id', participant.id)
        .then(({ error }) => {
          if (error) console.error('Failed to save challenge result:', error.message)
        })
      return current
    })

    setView('done')
  }

  const loadResults = useCallback(async () => {
    if (!challenge) return
    setLoadingResults(true)

    const [{ data: roster }, { data: participants }] = await Promise.all([
      supabase.from('crew_members').select('user_id').eq('crew_id', challenge.crew_id).eq('status', 'member'),
      supabase.from('challenge_participants').select('*').eq('challenge_id', challengeId),
    ])

    const userIds = (roster || []).map((r) => r.user_id)
    const { data: people } = await supabase
      .from('german_stats')
      .select('user_id, display_name')
      .in('user_id', userIds.length > 0 ? userIds : ['00000000-0000-0000-0000-000000000000'])
    const nameMap = Object.fromEntries((people || []).map((p) => [p.user_id, p.display_name]))

    const participantByUser = Object.fromEntries((participants || []).map((p) => [p.user_id, p]))

    const completed = []
    const waiting = []
    for (const uid of userIds) {
      const p = participantByUser[uid]
      const name = nameMap[uid] || tc.someone
      if (p && p.status === 'completed') {
        completed.push({
          user_id: uid,
          name,
          score: p.score,
          correct_count: p.correct_count,
          wrong_count: p.wrong_count,
          skipped_count: p.skipped_count,
          time_taken_ms: p.time_taken_ms || 0,
        })
      } else {
        waiting.push({
          user_id: uid,
          name,
          status: p?.status === 'in_progress' ? tc.statusInProgress : tc.statusNotStarted,
        })
      }
    }

    // Highest score wins; ties broken by whoever took less time.
    completed.sort((a, b) => b.score - a.score || a.time_taken_ms - b.time_taken_ms)

    setResults({ completed, waiting })
    setLoadingResults(false)
  }, [challenge, challengeId, tc])

  useEffect(() => {
    if (view === 'results' || view === 'done') loadResults()
  }, [view, loadResults])

  function formatTime(ms) {
    const totalSeconds = Math.round(ms / 1000)
    const minutes = Math.floor(totalSeconds / 60)
    const seconds = totalSeconds % 60
    return `${minutes}:${seconds.toString().padStart(2, '0')}`
  }

  if (!checked || loading) {
    return (
      <div className="flex-1 bg-black text-zinc-100 flex items-center justify-center">
        <p className="text-zinc-400">{tc.loading}</p>
      </div>
    )
  }

  if (!user) {
    return (
      <div className="flex-1 bg-black text-zinc-100 flex items-center justify-center">
        <p className="text-zinc-300">{tc.needAccount}</p>
      </div>
    )
  }

  if (notAllowed || !challenge) {
    return (
      <div className="flex-1 bg-black text-zinc-100 flex flex-col items-center justify-center gap-4 p-6 text-center">
        <p className="text-zinc-300">{tc.notAllowed}</p>
        <Link
          href="/learning/german/leaderboard"
          className="px-5 py-2 rounded-lg border border-zinc-700 text-zinc-200 hover:border-sky-400 transition"
        >
          {tc.backToCrews}
        </Link>
      </div>
    )
  }

  return (
    <div className="flex-1 bg-black text-zinc-100 flex flex-col items-center gap-6 p-6">
      <div className="w-full max-w-lg flex items-center justify-between">
        <h1 className="font-serif text-2xl text-sky-300">{tc.pageTitle}</h1>
        <Link href="/learning/german/leaderboard" className="text-xs text-zinc-400 hover:text-sky-300 transition">
          {tc.backToCrews}
        </Link>
      </div>

      {view === 'start' && (
        <div className="w-full max-w-lg bg-zinc-900 border border-zinc-700 rounded-xl p-6 flex flex-col items-center gap-4 text-center">
          <p className="text-lg text-zinc-100">
            {tc.summary(challenge.level === 'all' ? tc.levelAll : challenge.level, challenge.question_count)}
          </p>
          <p className="text-sm text-zinc-400 max-w-sm">
            {tc.introLine(challenge.question_count)} <span className="text-emerald-300">+2</span> {tc.correctLabel},{' '}
            <span className="text-rose-300">−1</span> {tc.wrongLabel}, <span className="text-zinc-300">0</span>{' '}
            {tc.skipLabel}. {tc.tieLine}
          </p>
          <button
            onClick={startChallenge}
            className="bg-sky-500 hover:bg-sky-400 text-zinc-950 font-medium px-6 py-2 rounded-xl transition"
          >
            {tc.startButton}
          </button>
        </div>
      )}

      {view === 'playing' && questions[currentIndex] && (
        <div className="w-full max-w-md flex flex-col items-center gap-4">
          <p className="text-xs text-zinc-500">{tc.questionProgress(currentIndex + 1, questions.length)}</p>
          <p className="text-xl text-center">{questions[currentIndex].question}</p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full">
            {[
              { key: 'a', text: questions[currentIndex].option_a },
              { key: 'b', text: questions[currentIndex].option_b },
              { key: 'c', text: questions[currentIndex].option_c },
              { key: 'd', text: questions[currentIndex].option_d },
            ].map((opt) => {
              const isCorrectOption = opt.key === questions[currentIndex].correct_option
              const isSelected = opt.key === selected
              let style = 'bg-zinc-900 border-zinc-700 hover:bg-zinc-800'
              if (answered && isCorrectOption) {
                style = 'bg-emerald-900 border-emerald-500 text-emerald-100'
              } else if (answered && isSelected && !isCorrectOption) {
                style = 'bg-rose-950 border-rose-500 text-rose-100'
              }
              return (
                <button
                  key={opt.key}
                  onClick={() => recordAnswer(opt.key)}
                  disabled={answered}
                  className={`border rounded-xl px-4 py-3 text-left transition ${style}`}
                >
                  {opt.text}
                </button>
              )
            })}
          </div>

          <div className="flex items-center gap-3">
            {!answered && (
              <button
                onClick={() => recordAnswer(null)}
                className="text-xs text-zinc-400 hover:text-zinc-200 underline underline-offset-2 transition"
              >
                {tc.skip}
              </button>
            )}
            {answered && (
              <button
                onClick={goToNext}
                className="bg-sky-500 hover:bg-sky-400 text-zinc-950 font-medium px-6 py-2 rounded-xl transition"
              >
                {currentIndex + 1 >= questions.length ? tc.finish : tc.next}
              </button>
            )}
          </div>
        </div>
      )}

      {view === 'done' && (
        <div className="w-full max-w-lg bg-zinc-900 border border-zinc-700 rounded-xl p-6 flex flex-col items-center gap-3 text-center">
          <p className="text-2xl">🏁</p>
          <p className="text-xl text-zinc-100">{tc.doneTitle(tally.score)}</p>
          <p className="text-sm text-zinc-400">{tc.doneBreakdown(tally.correct, tally.wrong, tally.skipped)}</p>
          <button
            onClick={() => setView('results')}
            className="bg-sky-500 hover:bg-sky-400 text-zinc-950 font-medium px-6 py-2 rounded-xl transition"
          >
            {tc.viewResults}
          </button>
        </div>
      )}

      {view === 'results' && (
        <div className="w-full max-w-lg flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <p className="text-xs text-zinc-500 uppercase tracking-wide">{tc.resultsTitle}</p>
            <button
              onClick={loadResults}
              className="text-xs text-sky-300 hover:text-sky-200 underline underline-offset-2 transition"
            >
              {tc.refresh}
            </button>
          </div>

          {loadingResults && <p className="text-sm text-zinc-500">{tc.loading}</p>}

          <div className="flex flex-col gap-2">
            {results.completed.map((r, i) => {
              const isYou = r.user_id === user.id
              return (
                <div
                  key={r.user_id}
                  className={`flex items-center justify-between rounded-xl px-4 py-3 border ${
                    isYou ? 'bg-sky-500/10 border-sky-500/40' : 'bg-zinc-900 border-zinc-800'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span className="text-zinc-500 text-sm w-6">#{i + 1}</span>
                    <span className={isYou ? 'text-sky-300 font-medium' : 'text-zinc-100'}>
                      {r.name} {isYou && tc.you}
                    </span>
                  </div>
                  <span className="text-sm text-zinc-300">
                    {r.score} {tc.pts} <span className="text-zinc-500">· {formatTime(r.time_taken_ms)}</span>
                  </span>
                </div>
              )
            })}
            {results.completed.length === 0 && !loadingResults && (
              <p className="text-sm text-zinc-500">{tc.noOneFinished}</p>
            )}
          </div>

          {results.waiting.length > 0 && (
            <div className="flex flex-col gap-1 pt-2 border-t border-zinc-800">
              <p className="text-[10px] text-zinc-500 uppercase tracking-wide">{tc.stillToGo}</p>
              {results.waiting.map((r) => (
                <p key={r.user_id} className="text-xs text-zinc-500">
                  {r.name} — {r.status}
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
