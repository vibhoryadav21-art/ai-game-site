'use client'

import { Suspense, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'

function LoginForm() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const searchParams = useSearchParams()
  const redirectTo = searchParams.get('redirect') || '/'

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)

    const { error } = await supabase.auth.signInWithPassword({ email, password })

    setLoading(false)
    if (error) {
      setError(error.message)
    } else {
      router.push(redirectTo)
      router.refresh()
    }
  }

  return (
    <div className="flex-1 flex items-center justify-center bg-zinc-950 p-6">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm bg-zinc-900 rounded-2xl p-8 flex flex-col gap-4 border border-zinc-700"
      >
        <h1 className="text-xl text-sky-300 font-serif mb-2">Log in</h1>
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email"
          className="rounded-lg bg-zinc-800 border border-zinc-600 text-zinc-50 p-2 placeholder:text-zinc-500 focus:outline-none focus:border-sky-400"
        />
        <input
          type="password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          className="rounded-lg bg-zinc-800 border border-zinc-600 text-zinc-50 p-2 placeholder:text-zinc-500 focus:outline-none focus:border-sky-400"
        />
        {error && <p className="text-rose-300 text-xs">{error}</p>}
        <button
          type="submit"
          disabled={loading}
          className="bg-sky-500 hover:bg-sky-400 disabled:opacity-50 text-zinc-950 font-medium rounded-lg py-2 transition"
        >
          {loading ? 'Logging in…' : 'Log in'}
        </button>
        <p className="text-zinc-400 text-xs text-center">
          No account yet?{' '}
          <a
            href={`/signup${redirectTo !== '/' ? `?redirect=${encodeURIComponent(redirectTo)}` : ''}`}
            className="text-sky-300 underline"
          >
            Sign up
          </a>
        </p>
      </form>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="flex-1 bg-zinc-950" />}>
      <LoginForm />
    </Suspense>
  )
}
