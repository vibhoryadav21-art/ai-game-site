'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ensureIdentity, getPlayerName, setPlayerName } from '@/lib/dohattiIdentity'
import { createRoom, getRoomByCode } from '@/lib/dohattiRooms'

export default function DoHattiLobbyPage() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    ensureIdentity()
    setName(getPlayerName())
    const fromUrl = new URLSearchParams(window.location.search).get('code')
    if (fromUrl) setCode(fromUrl.toUpperCase())
  }, [])

  function requireName() {
    if (!name.trim()) {
      setError('Please enter your name first.')
      return false
    }
    setPlayerName(name)
    return true
  }

  async function handleCreate() {
    setError('')
    if (!requireName()) return
    setBusy(true)
    try {
      const playerId = await ensureIdentity()
      const room = await createRoom(playerId, name.trim())
      router.push(`/games/dohatti/${room.code}`)
    } catch (e) {
      setError(e.message || 'Could not create the room.')
      setBusy(false)
    }
  }

  async function handleJoin() {
    setError('')
    if (!requireName()) return
    if (code.trim().length < 5) {
      setError('Enter the 5-character room code.')
      return
    }
    setBusy(true)
    try {
      await ensureIdentity()
      const room = await getRoomByCode(code)
      if (!room) {
        setError('No room with that code.')
        setBusy(false)
        return
      }
      router.push(`/games/dohatti/${room.code}`)
    } catch (e) {
      setError(e.message || 'Could not join the room.')
      setBusy(false)
    }
  }

  return (
    <div className="flex-1 bg-black text-zinc-100 flex flex-col items-center gap-8 px-6 py-16">
      <h1 className="font-serif text-3xl text-sky-300">Do Hatti</h1>

      <div className="w-full max-w-md flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <label className="text-sm text-zinc-400">Your name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={20}
            placeholder="e.g. Vibhor"
            className="bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-2 outline-none focus:border-sky-400"
          />
        </div>

        <div className="bg-emerald-900/40 border border-emerald-700/30 rounded-2xl p-6 flex flex-col gap-3">
          <h2 className="font-medium text-emerald-100">Create a new room</h2>
          <p className="text-xs text-emerald-300">
            You get a code to share with your friends. Empty seats can be filled with AI players.
          </p>
          <button
            onClick={handleCreate}
            disabled={busy}
            className="bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 rounded-lg py-2 transition"
          >
            Create room
          </button>
        </div>

        <div className="bg-emerald-900/40 border border-emerald-700/30 rounded-2xl p-6 flex flex-col gap-3">
          <h2 className="font-medium text-emerald-100">Join with a code</h2>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            maxLength={5}
            placeholder="ABCDE"
            className="bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-2 tracking-[0.4em] text-center uppercase outline-none focus:border-sky-400"
          />
          <button
            onClick={handleJoin}
            disabled={busy}
            className="bg-sky-700 hover:bg-sky-600 disabled:opacity-50 rounded-lg py-2 transition"
          >
            Join room
          </button>
        </div>

        {error && <p className="text-sm text-red-400">{error}</p>}

        <Link href="/games" className="text-sm text-zinc-500 hover:text-zinc-300 text-center">
          ← Back to games
        </Link>
      </div>
    </div>
  )
}
