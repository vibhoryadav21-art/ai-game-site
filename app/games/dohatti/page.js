'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ensureIdentity, getPlayerName, setPlayerName } from '@/lib/dohattiIdentity'
import { createRoom, getRoomByCode } from '@/lib/dohattiRooms'
import { useDohattiText } from '@/lib/dohattiText'

export default function DoHattiLobbyPage() {
  const { t } = useDohattiText()
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
      setError(t.enterName)
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
      setError(e.message || t.couldNotCreate)
      setBusy(false)
    }
  }

  async function handleJoin() {
    setError('')
    if (!requireName()) return
    if (code.trim().length < 5) {
      setError(t.enterCode)
      return
    }
    setBusy(true)
    try {
      await ensureIdentity()
      const room = await getRoomByCode(code)
      if (!room) {
        setError(t.noRoom)
        setBusy(false)
        return
      }
      router.push(`/games/dohatti/${room.code}`)
    } catch (e) {
      setError(e.message || t.couldNotJoin)
      setBusy(false)
    }
  }

  return (
    <div className="flex-1 bg-black text-zinc-100 flex flex-col items-center gap-8 px-6 py-16 text-base">
      <h1 className="font-serif text-3xl text-sky-300">{t.title}</h1>

      <div className="w-full max-w-md flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <label className="text-sm text-zinc-400">{t.yourName}</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={20}
            placeholder={t.namePlaceholder}
            className="bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-2.5 text-lg outline-none focus:border-sky-400"
          />
        </div>

        <div className="bg-emerald-900/40 border border-emerald-700/30 rounded-2xl p-6 flex flex-col gap-3">
          <h2 className="font-medium text-lg text-emerald-100">{t.createTitle}</h2>
          <p className="text-sm text-emerald-300">{t.createHint}</p>
          <button
            onClick={handleCreate}
            disabled={busy}
            className="bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 rounded-lg py-2.5 text-lg transition active:scale-95"
          >
            {t.createButton}
          </button>
        </div>

        <div className="bg-emerald-900/40 border border-emerald-700/30 rounded-2xl p-6 flex flex-col gap-3">
          <h2 className="font-medium text-lg text-emerald-100">{t.joinTitle}</h2>
          <input
            dir="ltr"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            maxLength={5}
            placeholder="ABCDE"
            className="bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-2.5 text-xl tracking-[0.4em] text-center uppercase outline-none focus:border-sky-400"
          />
          <button
            onClick={handleJoin}
            disabled={busy}
            className="bg-sky-700 hover:bg-sky-600 disabled:opacity-50 rounded-lg py-2.5 text-lg transition active:scale-95"
          >
            {t.joinButton}
          </button>
        </div>

        {error && <p className="text-base text-red-400 text-center">{error}</p>}

        <Link href="/games" className="text-base text-zinc-500 hover:text-zinc-300 text-center">
          {t.backToGames}
        </Link>
      </div>
    </div>
  )
}
