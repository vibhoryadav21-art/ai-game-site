'use client'

import { Suspense, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'

function SignUpForm() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  const router = useRouter()
  const searchParams = useSearchParams()
  const redirectTo = searchParams.get('redirect')

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)

    const { error } = await supabase.auth.signUp({ email, password })

    setLoading(false)
    if (error) {
      setError(error.message)
    } else {
      setDone(true)
    }
  }

  function goToLogin() {
    router.push(redirectTo ? `/login?redirect=${encodeURIComponent(redirectTo)}` : '/login')
  }

  return (
    <div className="flex-1 flex items-center justify-center bg-zinc-950 p-6">
      <div className="w-full max-w-sm bg-zinc-900 rounded-2xl p-8 border border-zinc-700">
        <h1 className="text-xl text-sky-300 font-serif mb-6">Create an account</h1>

        {done ? (
          <div className="flex flex-col gap-4">
            <p className="text-zinc-200 text-sm">
              Check your email for a confirmation link, then log in.
            </p>
            <button
              onClick={goToLogin}
              className="bg-sky-500 hover:bg-sky-400 text-zinc-950 font-medium rounded-lg py-2 transition"
            >
              Go to login
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
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
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password (min 6 characters)"
              className="rounded-lg bg-zinc-800 border border-zinc-600 text-zinc-50 p-2 placeholder:text-zinc-500 focus:outline-none focus:border-sky-400"
            />
            {error && <p className="text-rose-300 text-xs">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="bg-sky-500 hover:bg-sky-400 disabled:opacity-50 text-zinc-950 font-medium rounded-lg py-2 transition"
            >
              {loading ? 'Creating account…' : 'Sign up'}
            </button>
            <p className="text-zinc-400 text-xs text-center">
              Already have an account?{' '}
              <a
                href={redirectTo ? `/login?redirect=${encodeURIComponent(redirectTo)}` : '/login'}
                className="text-sky-300 underline"
              >
                Log in
              </a>
            </p>
          </form>
        )}
      </div>
    </div>
  )
}

export default function SignUpPage() {
  return (
    <Suspense fallback={<div className="flex-1 bg-zinc-950" />}>
      <SignUpForm />
    </Suspense>
  )
}
