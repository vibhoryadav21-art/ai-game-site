'use client'

import { useEffect, useState } from 'react'

// Cycles through greetings regardless of the site's selected language —
// a "welcome, wherever you're from" gesture, not tied to the language switcher.
const GREETINGS = [
  'Welcome',
  'Willkommen',
  'أهلاً وسهلاً',
  'Bienvenue',
  'Bienvenido',
  '欢迎',
  'स्वागत है',
]

function RotatingGreeting() {
  const [index, setIndex] = useState(0)
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    const interval = setInterval(() => {
      setVisible(false)
      setTimeout(() => {
        setIndex((i) => (i + 1) % GREETINGS.length)
        setVisible(true)
      }, 300)
    }, 2200)
    return () => clearInterval(interval)
  }, [])

  return (
    <h1
      className={`font-serif text-5xl text-sky-300 text-center transition-opacity duration-300 ${
        visible ? 'opacity-100' : 'opacity-0'
      }`}
    >
      {GREETINGS[index]}
    </h1>
  )
}

export default function HomePage() {
  return (
    <div className="flex-1 bg-zinc-950 text-zinc-100 flex items-center justify-center px-6">
      <RotatingGreeting />
    </div>
  )
}
