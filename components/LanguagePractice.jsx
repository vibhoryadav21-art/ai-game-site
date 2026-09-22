'use client'

import { useState } from 'react'
import { supabase } from '@/lib/supabaseClient'

function shuffle(arr) {
  return [...arr].sort(() => Math.random() - 0.5)
}

function Flashcard({ items }) {
  const [index, setIndex] = useState(0)
  const [flipped, setFlipped] = useState(false)

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
    <div className="flex flex-col items-center gap-4">
      <p className="text-sm text-zinc-500">{index + 1} / {items.length}</p>

      <div
        onClick={() => setFlipped((f) => !f)}
        className="w-full max-w-sm h-56 rounded-2xl border border-zinc-800 bg-zinc-900 cursor-pointer
                   flex flex-col items-center justify-center gap-2 p-6 text-center hover:border-sky-500/50 transition"
      >
        {!flipped ? (
          <>
            <span className="text-4xl font-bold text-sky-300">{item.native}</span>
            <span className="text-lg text-zinc-400 italic">{item.roman}</span>
            <span className="text-xs text-zinc-600 mt-2">(tap to reveal meaning)</span>
          </>
        ) : (
          <span className="text-2xl font-semibold text-zinc-100">{item.english}</span>
        )}
      </div>

      <div className="flex gap-3">
        <button
          onClick={prev}
          className="px-4 py-2 rounded-lg border border-zinc-700 text-zinc-200 hover:border-sky-400 transition"
        >
          ← Prev
        </button>
        <button
          onClick={next}
          className="px-4 py-2 rounded-lg bg-sky-500 hover:bg-sky-400 text-zinc-950 font-medium transition"
        >
          Next →
        </button>
      </div>
    </div>
  )
}

function QuizMCQ({ items, onFinish }) {
  const [questions] = useState(() =>
    shuffle(items).map((item) => {
      const distractors = shuffle(items.filter((i) => i.id !== item.id))
        .slice(0, 3)
        .map((i) => i.english)
      return { item, options: shuffle([item.english, ...distractors]) }
    })
  )
  const [qIndex, setQIndex] = useState(0)
  const [score, setScore] = useState(0)
  const [selected, setSelected] = useState(null)
  const [done, setDone] = useState(false)

  if (items.length < 4) {
    return <p className="text-zinc-500">Need at least 4 items in this category for a quiz.</p>
  }

  if (done) {
    return (
      <div className="text-center space-y-4">
        <p className="text-2xl font-bold text-sky-300">
          Score: {score} / {questions.length}
        </p>
        <button
          onClick={() => onFinish(score, questions.length)}
          className="px-4 py-2 rounded-lg bg-sky-500 hover:bg-sky-400 text-zinc-950 font-medium transition"
        >
          Continue
        </button>
      </div>
    )
  }

  const q = questions[qIndex]

  function choose(option) {
    if (selected) return
    setSelected(option)
    if (option === q.item.english) setScore((s) => s + 1)
  }

  function next() {
    setSelected(null)
    if (qIndex + 1 >= questions.length) setDone(true)
    else setQIndex((i) => i + 1)
  }

  return (
    <div className="flex flex-col items-center gap-5 max-w-sm mx-auto">
      <p className="text-sm text-zinc-500">Question {qIndex + 1} / {questions.length}</p>

      <div className="text-center">
        <p className="text-3xl font-bold text-sky-300">{q.item.native}</p>
        <p className="text-lg text-zinc-400 italic">{q.item.roman}</p>
        <p className="text-sm text-zinc-600 mt-1">What does this mean?</p>
      </div>

      <div className="w-full flex flex-col gap-2">
        {q.options.map((opt) => {
          const isCorrect = opt === q.item.english
          const revealed = selected !== null
          let style = 'border-zinc-700 hover:border-sky-400 bg-zinc-900'
          if (revealed && opt === selected && isCorrect) style = 'border-emerald-600 bg-emerald-900/40'
          if (revealed && opt === selected && !isCorrect) style = 'border-rose-700 bg-rose-900/40'
          if (revealed && opt !== selected && isCorrect) style = 'border-emerald-600/60 bg-emerald-900/20'

          return (
            <button
              key={opt}
              onClick={() => choose(opt)}
              className={`px-4 py-2 rounded-lg text-left border text-zinc-100 ${style}`}
            >
              {opt}
            </button>
          )
        })}
      </div>

      {selected && (
        <button
          onClick={next}
          className="px-4 py-2 rounded-lg bg-sky-500 hover:bg-sky-400 text-zinc-950 font-medium transition"
        >
          {qIndex + 1 >= questions.length ? 'See Score' : 'Next Question →'}
        </button>
      )}
    </div>
  )
}

export default function LanguagePractice({ course, statsTable, user, stats, onStatsChange }) {
  const [categoryId, setCategoryId] = useState(course.categories[0].id)
  const [mode, setMode] = useState('flashcards')
  const [quizKey, setQuizKey] = useState(0)

  const category = course.categories.find((c) => c.id === categoryId)

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
    <div className="flex-1 bg-black text-zinc-100 flex flex-col items-center gap-8 px-6 py-16">
      <div className="text-center space-y-1">
        <h1 className="font-serif text-3xl text-sky-300">
          {course.flag} Learn {course.name}
        </h1>
        <p className="text-zinc-500 text-sm">Level: A1 (Beginner)</p>
        {accuracy !== null && (
          <p className="text-zinc-600 text-xs">
            Lifetime: {stats.total_correct}/{stats.total_answered} correct ({accuracy}%)
          </p>
        )}
      </div>

      <div className="flex flex-wrap justify-center gap-2">
        {course.categories.map((c) => (
          <button
            key={c.id}
            onClick={() => {
              setCategoryId(c.id)
              setMode('flashcards')
            }}
            className={`px-3 py-1.5 rounded-full text-sm border transition ${
              c.id === categoryId
                ? 'bg-sky-500 text-zinc-950 border-sky-500'
                : 'border-zinc-700 text-zinc-300 hover:border-sky-400'
            }`}
          >
            {c.title}
          </button>
        ))}
      </div>

      <div className="flex justify-center gap-2">
        <button
          onClick={() => setMode('flashcards')}
          className={`px-4 py-1.5 rounded-lg text-sm transition ${
            mode === 'flashcards' ? 'bg-zinc-100 text-zinc-950' : 'border border-zinc-700 text-zinc-300'
          }`}
        >
          Flashcards
        </button>
        <button
          onClick={() => setMode('quiz')}
          className={`px-4 py-1.5 rounded-lg text-sm transition ${
            mode === 'quiz' ? 'bg-zinc-100 text-zinc-950' : 'border border-zinc-700 text-zinc-300'
          }`}
        >
          Quiz
        </button>
      </div>

      <div key={`${categoryId}-${mode}-${quizKey}`}>
        {mode === 'flashcards' ? (
          <Flashcard items={category.items} />
        ) : (
          <QuizMCQ items={category.items} onFinish={handleQuizFinish} />
        )}
      </div>
    </div>
  )
}