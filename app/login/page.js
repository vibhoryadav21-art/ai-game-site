'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)

    const { error } = await supabase.auth.signInWithPassword({ email, password })

    setLoading(false)
    if (error) {
      setError(error.message)
    } else {
      router.push('/game')
      router.refresh()
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-emerald-950 p-6">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm bg-emerald-900 rounded-2xl p-8 flex flex-col gap-4 border border-emerald-700/40"
      >
        <h1 className="text-xl text-amber-300 font-serif mb-2">Log in</h1>
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email"
          className="rounded-lg bg-emerald-800 border border-emerald-600/50 text-emerald-50 p-2 placeholder:text-emerald-400 focus:outline-none focus:border-amber-400"
        />
        <input
          type="password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          className="rounded-lg bg-emerald-800 border border-emerald-600/50 text-emerald-50 p-2 placeholder:text-emerald-400 focus:outline-none focus:border-amber-400"
        />
        {error && <p className="text-rose-300 text-xs">{error}</p>}
        <button
          type="submit"
          disabled={loading}
          className="bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-emerald-950 font-medium rounded-lg py-2 transition"
        >
          {loading ? 'Logging in…' : 'Log in'}
        </button>
        <p className="text-emerald-300 text-xs text-center">
          No account yet?{' '}
          <a href="/signup" className="text-amber-300 underline">
            Sign up
          </a>
        </p>
      </form>
    </div>
  )
}
