'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabaseClient'
import { useLanguage } from '@/context/LanguageContext'

export default function TriviaInboxPage() {
  const { t } = useLanguage()
  const ti = t.inbox
  const [checked, setChecked] = useState(false)
  const [user, setUser] = useState(null)
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null)
      setChecked(true)
    })
  }, [])

  const loadInbox = useCallback(async (userId) => {
    setLoading(true)

    const { data: sent, error } = await supabase
      .from('sent_trivia_questions')
      .select('*')
      .eq('receiver_id', userId)
      .order('created_at', { ascending: false })

    if (error || !sent) {
      console.error('Failed to load inbox:', error?.message)
      setLoading(false)
      return
    }

    const questionIds = [...new Set(sent.map((s) => s.question_id))]
    const senderIds = [...new Set(sent.map((s) => s.sender_id))]

    const [{ data: questions }, { data: senders }] = await Promise.all([
      supabase.from('trivia_questions').select('*').in('id', questionIds),
      supabase.from('trivia_stats').select('user_id, display_name').in('user_id', senderIds),
    ])

    const questionMap = Object.fromEntries((questions || []).map((q) => [q.id, q]))
    const senderMap = Object.fromEntries((senders || []).map((s) => [s.user_id, s.display_name]))

    const merged = sent.map((s) => ({
      ...s,
      question: questionMap[s.question_id],
      senderName: senderMap[s.sender_id] || ti.someone,
    }))

    setItems(merged)
    setLoading(false)
  }, [])

  useEffect(() => {
    if (checked && user) loadInbox(user.id)
  }, [checked, user, loadInbox])

  async function answerItem(item, selected) {
    const receiverCorrect = selected === item.question.correct_option

    const { error } = await supabase
      .from('sent_trivia_questions')
      .update({
        receiver_answer: selected,
        receiver_correct: receiverCorrect,
        answered_at: new Date().toISOString(),
      })
      .eq('id', item.id)

    if (error) {
      console.error('Failed to save answer:', error.message)
      return
    }

    // Also count it toward this user's overall stats.
    const { data: stats } = await supabase
      .from('trivia_stats')
      .select('*')
      .eq('user_id', user.id)
      .single()

    if (stats) {
      const level = item.question.level
      const levelStats = { ...stats.level_stats }
      const prev = levelStats[level] || { correct: 0, total: 0 }
      levelStats[level] = {
        correct: prev.correct + (receiverCorrect ? 1 : 0),
        total: prev.total + 1,
      }
      const newScore = Math.max(0, (stats.score || 0) + (receiverCorrect ? 1 : -1))
      await supabase
        .from('trivia_stats')
        .update({
          score: newScore,
          total_answered: stats.total_answered + 1,
          total_correct: stats.total_correct + (receiverCorrect ? 1 : 0),
          level_stats: levelStats,
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', user.id)
    }

    setItems((prevItems) =>
      prevItems.map((i) =>
        i.id === item.id
          ? { ...i, receiver_answer: selected, receiver_correct: receiverCorrect }
          : i
      )
    )
  }

  if (!checked || loading) {
    return (
      <div className="flex-1 bg-black text-zinc-100 flex items-center justify-center">
        <p className="text-zinc-400">{ti.loading}</p>
      </div>
    )
  }

  if (!user) {
    return (
      <div className="flex-1 bg-black text-zinc-100 flex items-center justify-center">
        <p className="text-zinc-300">{ti.loginPrompt}</p>
      </div>
    )
  }

  return (
    <div className="flex-1 bg-black text-zinc-100 flex flex-col items-center gap-6 p-6">
      <div className="w-full max-w-lg flex items-center justify-between">
        <h1 className="font-serif text-2xl text-sky-300">{ti.title}</h1>
        <Link href="/learning/trivia" className="text-xs text-zinc-400 hover:text-sky-300 transition">
          {ti.backToPractice}
        </Link>
      </div>

      {items.length === 0 && (
        <p className="text-zinc-500 text-sm">{ti.empty}</p>
      )}

      <div className="w-full max-w-lg flex flex-col gap-4">
        {items.map((item) => {
          const answered = item.receiver_answer != null
          const options = item.question
            ? [
                { key: 'a', text: item.question.option_a },
                { key: 'b', text: item.question.option_b },
                { key: 'c', text: item.question.option_c },
                { key: 'd', text: item.question.option_d },
              ]
            : []

          return (
            <div key={item.id} className="bg-zinc-900 border border-zinc-700 rounded-2xl p-5 flex flex-col gap-3">
              <p className="text-xs text-zinc-500">
                {ti.from(item.senderName)} · {item.question?.level}
              </p>
              <p className="text-zinc-100">{item.question?.question}</p>

              {!answered ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {options.map((opt) => (
                    <button
                      key={opt.key}
                      onClick={() => answerItem(item, opt.key)}
                      className="bg-zinc-800 hover:bg-zinc-700 border border-zinc-600 rounded-lg px-3 py-2 text-sm text-left transition"
                    >
                      {opt.text}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col gap-1 text-sm">
                  <p className={item.receiver_correct ? 'text-emerald-300' : 'text-rose-300'}>
                    {ti.you}: {item.receiver_answer.toUpperCase()} {item.receiver_correct ? '✓' : '✗'}
                  </p>
                  <p className={item.sender_correct ? 'text-emerald-300' : 'text-rose-300'}>
                    {item.senderName}: {item.sender_answer.toUpperCase()} {item.sender_correct ? '✓' : '✗'}
                  </p>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
