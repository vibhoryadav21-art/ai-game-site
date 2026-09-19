'use client'

import { useEffect, useState } from 'react'

// Each variant pairs one logo color with the word that represents it.
const VARIANTS = [
  { logo: '/logo-auszeit-blue.png', word: 'Entertainment.' },
  { logo: '/logo-auszeit-purple.png', word: 'Learning.' },
  { logo: '/logo-auszeit-orange.png', word: 'Socializing.' },
]

const INTERVAL_MS = 3500
const FADE_MS = 300

export default function HomePage() {
  const [index, setIndex] = useState(0)
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    const interval = setInterval(() => {
      setVisible(false)
      setTimeout(() => {
        setIndex((i) => (i + 1) % VARIANTS.length)
        setVisible(true)
      }, FADE_MS)
    }, INTERVAL_MS)
    return () => clearInterval(interval)
  }, [])

  const current = VARIANTS[index]

  return (
    <div className="flex-1 bg-black flex flex-col items-center justify-center gap-5 px-6">
      <img
        src={current.logo}
        alt="auszeit."
        className={`h-16 md:h-20 w-auto transition-opacity duration-300 ${
          visible ? 'opacity-100' : 'opacity-0'
        }`}
      />
      <p className="text-zinc-400 text-sm tracking-wide">own your time!</p>
      <p
        className={`text-lg text-zinc-200 transition-opacity duration-300 ${
          visible ? 'opacity-100' : 'opacity-0'
        }`}
      >
        {current.word}
      </p>
    </div>
  )
}
