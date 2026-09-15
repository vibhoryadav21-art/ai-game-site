'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'

export default function SignUpPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  const router = useRouter()

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

  return (
    <div className="min-h-screen flex items-center justify-center bg-emerald-950 p-6">
      <div className="w-full max-w-sm bg-emerald-900 rounded-2xl p-8 border border-emerald-700/40">
        <h1 className="text-xl text-amber-300 font-serif mb-6">Create an account</h1>

        {done ? (
          <div className="flex flex-col gap-4">
            <p className="text-emerald-100 text-sm">
              Check your email for a confirmation link, then log in.
            </p>
            <button
              onClick={() => router.push('/login')}
              className="bg-amber-500 hover:bg-amber-400 text-emerald-950 font-medium rounded-lg py-2 transition"
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
              className="rounded-lg bg-emerald-800 border border-emerald-600/50 text-emerald-50 p-2 placeholder:text-emerald-400 focus:outline-none focus:border-amber-400"
            />
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password (min 6 characters)"
              className="rounded-lg bg-emerald-800 border border-emerald-600/50 text-emerald-50 p-2 placeholder:text-emerald-400 focus:outline-none focus:border-amber-400"
            />
            {error && <p className="text-rose-300 text-xs">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-emerald-950 font-medium rounded-lg py-2 transition"
            >
              {loading ? 'Creating account…' : 'Sign up'}
            </button>
            <p className="text-emerald-300 text-xs text-center">
              Already have an account?{' '}
              <a href="/login" className="text-amber-300 underline">
                Log in
              </a>
            </p>
          </form>
        )}
      </div>
    </div>
  )
}
