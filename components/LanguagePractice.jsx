'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabaseClient'

const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1']

function shuffle(arr) {
  return [...arr].sort(() => Math.random() - 0.5)
}

function Flashcard({ items }) {
  const [index, setIndex] = useState(0)
  const [flipped, setFlipped] = useState(false)

  // Reset to the first card whenever the underlying item list changes
  // (e.g. switching topic or level).
  useEffect(() => {
    setIndex(0)
    setFlipped(false)
  }, [items])

  if (items.length === 0) return null
  const item = items[index]

  function next() {
    setFlipped(false)
    setIndex((i) => (i + 1) % items.length)
  }
  function prev() {
    setFlipped(false)
    setIndex((i) => (i - 1 + items.length) % items.length)
  }

  return (
    <div className="flex flex-col items-center gap-3 w-full">
      <p className="text-xs text-zinc-500">{index + 1} / {items.length}</p>

      <div
        onClick={() => setFlipped((f) => !f)}
        className="w-full max-w-sm h-52 rounded-2xl border border-zinc-800 bg-zinc-900 cursor-pointer
                   flex flex-col items-center justify-center gap-2 p-6 text-center active:border-sky-500/50 transition"
      >
        {!flipped ? (
          <>
            <span className="text-4xl font-bold text-sky-300">{item.native}</span>
            <span className="text-lg text-zinc-400 italic">{item.roman}</span>
            <span className="text-xs text-zinc-600 mt-2">(tap to reveal meaning)</span>
          </>
        ) : (
          <span className="text-xl font-semibold text-zinc-100">{item.english}</span>
        )}
      </div>

      <div className="flex gap-3 w-full max-w-sm">
        <button
          onClick={prev}
          className="flex-1 px-4 py-2.5 rounded-lg border border-zinc-700 text-zinc-200 active:border-sky-400 transition"
        >
          ← Prev
        </button>
        <button
          onClick={next}
          className="flex-1 px-4 py-2.5 rounded-lg bg-sky-500 active:bg-sky-400 text-zinc-950 font-medium transition"
        >
          Next →
        </button>
      </div>
    </div>
  )
}

// Quiz reads its questions from Supabase (table + category), each row
// already carrying its 4 fixed options and correct answer.
function QuizMCQ({ table, category, onFinish }) {
  const [questions, setQuestions] = useState(null) // null = still loading
  const [qIndex, setQIndex] = useState(0)
  const [score, setScore] = useState(0)
  const [selected, setSelected] = useState(null)
  const [done, setDone] = useState(false)

  useEffect(() => {
    let active = true
    setQuestions(null)
    setQIndex(0)
    setScore(0)
    setSelected(null)
    setDone(false)

    supabase
      .from(table)
      .select('*')
      .eq('category', category)
      .then(({ data, error }) => {
        if (!active) return
        if (error) {
          console.error(`Failed to load ${table}:`, error.message)
          setQuestions([])
          return
        }
        setQuestions(shuffle(data || []))
      })

    return () => {
      active = false
    }
  }, [table, category])

  if (questions === null) {
    return <p className="text-zinc-500 text-sm">Loading questions…</p>
  }

  if (questions.length === 0) {
    return <p className="text-zinc-500 text-sm text-center">No quiz questions yet for this topic.</p>
  }

  if (done) {
    return (
      <div className="text-center space-y-4">
        <p className="text-2xl font-bold text-sky-300">
          Score: {score} / {questions.length}
        </p>
        <button
          onClick={() => onFinish(score, questions.length)}
          className="px-4 py-2.5 rounded-lg bg-sky-500 active:bg-sky-400 text-zinc-950 font-medium transition"
        >
          Continue
        </button>
      </div>
    )
  }

  const q = questions[qIndex]
  const options = [q.option_a, q.option_b, q.option_c, q.option_d]
  const correctText = q['option_' + q.correct_option]

  function choose(option) {
    if (selected) return
    setSelected(option)
    if (option === correctText) setScore((s) => s + 1)
  }

  function next() {
    setSelected(null)
    if (qIndex + 1 >= questions.length) setDone(true)
    else setQIndex((i) => i + 1)
  }

  return (
    <div className="flex flex-col items-center gap-4 w-full max-w-sm">
      <p className="text-xs text-zinc-500">Question {qIndex + 1} / {questions.length}</p>

      <div className="text-center">
        <p className="text-3xl font-bold text-sky-300">{q.native}</p>
        <p className="text-lg text-zinc-400 italic">{q.roman}</p>
        <p className="text-sm text-zinc-600 mt-1">What does this mean?</p>
      </div>

      {/* 2x2 grid, sized for thumbs */}
      <div className="w-full grid grid-cols-2 gap-2">
        {options.map((opt) => {
          const isCorrect = opt === correctText
          const revealed = selected !== null
          let style = 'border-zinc-700 active:border-sky-400 bg-zinc-900'
          if (revealed && opt === selected && isCorrect) style = 'border-emerald-600 bg-emerald-900/40'
          if (revealed && opt === selected && !isCorrect) style = 'border-rose-700 bg-rose-900/40'
          if (revealed && opt !== selected && isCorrect) style = 'border-emerald-600/60 bg-emerald-900/20'

          return (
            <button
              key={opt}
              onClick={() => choose(opt)}
              className={`min-h-[64px] px-2 py-2 rounded-lg border text-zinc-100 text-sm leading-snug
                          flex items-center justify-center text-center ${style}`}
            >
              {opt}
            </button>
          )
        })}
      </div>

      {selected && (
        <button
          onClick={next}
          className="w-full px-4 py-2.5 rounded-lg bg-sky-500 active:bg-sky-400 text-zinc-950 font-medium transition"
        >
          {qIndex + 1 >= questions.length ? 'See Score' : 'Next Question →'}
        </button>
      )}
    </div>
  )
}

export default function LanguagePractice({ course, statsTable, user, stats, onStatsChange }) {
  const [level, setLevel] = useState('A1')

  const categoriesForLevel = course.categories.filter((c) => (c.level || 'A1') === level)
  const [categoryId, setCategoryId] = useState(categoriesForLevel[0]?.id ?? '')
  const [mode, setMode] = useState('flashcards')
  const [quizKey, setQuizKey] = useState(0)

  // Whenever the level changes, jump to the first topic available at that level.
  useEffect(() => {
    const list = course.categories.filter((c) => (c.level || 'A1') === level)
    setCategoryId(list[0]?.id ?? '')
    setMode('flashcards')
  }, [level, course])

  const category = categoriesForLevel.find((c) => c.id === categoryId)
  const questionsTable = statsTable.replace('_stats', '_questions')

  async function handleQuizFinish(score, total) {
    const updated = {
      total_answered: (stats.total_answered || 0) + total,
      total_correct: (stats.total_correct || 0) + score,
    }
    const { data, error } = await supabase
      .from(statsTable)
      .update(updated)
      .eq('user_id', user.id)
      .select()
      .single()

    if (error) {
      console.error(`Failed to update ${statsTable}:`, error.message)
    } else {
      onStatsChange(data)
    }
    setQuizKey((k) => k + 1)
    setMode('flashcards')
  }

  const accuracy = stats?.total_answered
    ? Math.round((stats.total_correct / stats.total_answered) * 100)
    : null

  return (
    <div className="flex-1 bg-black text-zinc-100 flex flex-col items-center gap-5 px-4 py-6">
      {/* Level + topic dropdowns, side by side to save vertical space */}
      <div className="w-full max-w-sm flex gap-2">
        <select
          value={level}
          onChange={(e) => setLevel(e.target.value)}
          className="w-24 shrink-0 bg-zinc-900 border border-zinc-700 text-zinc-100 text-sm rounded-lg px-2 py-2.5 focus:outline-none focus:border-sky-400"
        >
          {LEVELS.map((lvl) => (
            <option key={lvl} value={lvl}>
              {lvl}
            </option>
          ))}
        </select>

        {categoriesForLevel.length > 0 ? (
          <select
            value={categoryId}
            onChange={(e) => {
              setCategoryId(e.target.value)
              setMode('flashcards')
            }}
            className="flex-1 bg-zinc-900 border border-zinc-700 text-zinc-100 text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-sky-400"
          >
            {categoriesForLevel.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        ) : (
          <p className="flex-1 flex items-center justify-center text-center text-zinc-500 text-sm">
            No topics yet for {level}.
          </p>
        )}
      </div>

      {accuracy !== null && (
        <p className="text-zinc-600 text-xs -mt-2">
          Lifetime: {stats.total_correct}/{stats.total_answered} correct ({accuracy}%)
        </p>
      )}

      {/* Mode toggle */}
      {category && (
        <div className="flex gap-2 w-full max-w-sm">
          <button
            onClick={() => setMode('flashcards')}
            className={`flex-1 px-4 py-2 rounded-lg text-sm transition ${
              mode === 'flashcards' ? 'bg-zinc-100 text-zinc-950' : 'border border-zinc-700 text-zinc-300'
            }`}
          >
            Flashcards
          </button>
          <button
            onClick={() => setMode('quiz')}
            className={`flex-1 px-4 py-2 rounded-lg text-sm transition ${
              mode === 'quiz' ? 'bg-zinc-100 text-zinc-950' : 'border border-zinc-700 text-zinc-300'
            }`}
          >
            Quiz
          </button>
        </div>
      )}

      {category && (
        <div key={`${categoryId}-${mode}-${quizKey}`} className="w-full flex justify-center">
          {mode === 'flashcards' ? (
            <Flashcard items={category.items} />
          ) : (
            <QuizMCQ table={questionsTable} category={categoryId} onFinish={handleQuizFinish} />
          )}
        </div>
      )}
    </div>
  )
}
