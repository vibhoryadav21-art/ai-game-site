'use client'

import { useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { useLanguage } from '@/context/LanguageContext'
import { useFeedback } from '@/context/FeedbackContext'

const FEEDBACK_LIMIT = 100

export default function FeedbackWidget() {
  const { t } = useLanguage()
  const { isOpen, closeFeedback } = useFeedback()
  const [game, setGame] = useState('general')
  const [text, setText] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')

  const GAMES = [
    { id: 'general', label: t.game.gameGeneral },
    { id: 'higher_lower', label: t.game.gameHigherLower },
    { id: 'german', label: t.learningHub.german },
    { id: 'trivia', label: t.learningHub.trivia },
  ]

  async function submitFeedback() {
    const trimmed = text.trim()
    if (!trimmed) return
    setError('')

    const { data: session } = await supabase.auth.getSession()
    const userId = session?.session?.user?.id ?? null

    const { error: insertError } = await supabase.from('feedback').insert({
      user_id: userId,
      message: trimmed,
      game,
    })

    if (insertError) {
      setError(t.game.feedbackError)
      return
    }

    setSent(true)
    setText('')
    setTimeout(() => {
      setSent(false)
      closeFeedback()
    }, 1500)
  }

  if (!isOpen) return null

  return (
    <div className="fixed bottom-4 right-4 z-50">
      <div className="bg-zinc-900 border border-zinc-700 rounded-2xl p-4 w-72 flex flex-col gap-2 shadow-2xl">
        {sent ? (
          <p className="text-xs text-emerald-300">{t.game.feedbackThanks}</p>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <p className="text-xs text-zinc-400">{t.game.feedbackPrompt}</p>
              <button
                onClick={closeFeedback}
                className="text-zinc-500 hover:text-zinc-300 text-xs"
              >
                ✕
              </button>
            </div>
            <select
              value={game}
              onChange={(e) => setGame(e.target.value)}
              className="w-full rounded-lg bg-zinc-800 border border-zinc-600 text-zinc-50 text-xs p-2 focus:outline-none focus:border-sky-400"
            >
              {GAMES.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.label}
                </option>
              ))}
            </select>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value.slice(0, FEEDBACK_LIMIT))}
              maxLength={FEEDBACK_LIMIT}
              rows={2}
              placeholder={t.game.feedbackPlaceholder}
              className="w-full resize-none rounded-lg bg-zinc-800 border border-zinc-600 text-zinc-50 text-xs p-2 placeholder:text-zinc-500 focus:outline-none focus:border-sky-400"
            />
            {error && <p className="text-[10px] text-rose-300">{error}</p>}
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-zinc-500">
                {text.length}/{FEEDBACK_LIMIT}
              </span>
              <button
                onClick={submitFeedback}
                disabled={!text.trim()}
                className="text-xs bg-sky-500 hover:bg-sky-400 disabled:opacity-40 text-zinc-950 font-medium px-3 py-1 rounded-lg transition"
              >
                {t.game.send}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
