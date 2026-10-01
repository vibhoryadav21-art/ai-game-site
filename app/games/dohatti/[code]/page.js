'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabaseClient'
import { getPlayerId, getPlayerName } from '@/lib/dohattiIdentity'
import {
  getRoomByCode,
  getSeats,
  claimSeat,
  setSeatAI,
  fillWithAI,
  startGame,
  leaveRoom,
} from '@/lib/dohattiRooms'

// seat 0 = bottom, 1 = left, 2 = top, 3 = right
const SEAT_POSITION = {
  0: 'col-start-2 row-start-3',
  1: 'col-start-1 row-start-2',
  2: 'col-start-2 row-start-1',
  3: 'col-start-3 row-start-2',
}

export default function DoHattiRoomPage() {
  const { code } = useParams()
  const router = useRouter()
  const [me, setMe] = useState(null)
  const [room, setRoom] = useState(null)
  const [seats, setSeats] = useState([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState(false)
  const startedRef = useRef(false)

  const refreshSeats = useCallback(async (roomId) => {
    try {
      setSeats(await getSeats(roomId))
    } catch {
      setError('Could not load the seats.')
    }
  }, [])

  // Load the room and sit down in the first free seat
  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true

    async function init() {
      const playerId = getPlayerId()
      const name = getPlayerName()
      if (!name) {
        router.replace(`/games/dohatti?code=${code}`)
        return
      }
      setMe(playerId)

      try {
        const r = await getRoomByCode(code)
        if (!r) {
          setError('Room not found. Check the code.')
          setLoading(false)
          return
        }

        let current = await getSeats(r.id)
        const alreadySeated = current.some((s) => s.player_id === playerId)

        if (!alreadySeated) {
          if (r.status !== 'waiting') {
            setError('This game has already started.')
            setLoading(false)
            return
          }
          const empty = current.find((s) => !s.player_id && !s.is_ai)
          if (!empty) {
            setError('This room is full.')
            setLoading(false)
            return
          }
          await claimSeat(r.id, empty.seat, playerId, name)
          current = await getSeats(r.id)
          if (!current.some((s) => s.player_id === playerId)) {
            setError('That seat was just taken. Reload the page to try again.')
            setLoading(false)
            return
          }
        }

        setRoom(r)
        setSeats(current)
        setLoading(false)
      } catch (e) {
        setError(e.message || 'Something went wrong.')
        setLoading(false)
      }
    }

    init()
  }, [code, router])

  // Live updates for seats and room status
  useEffect(() => {
    if (!room?.id) return
    const channel = supabase
      .channel(`dohatti-room-${room.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'dohatti_players', filter: `room_id=eq.${room.id}` },
        () => refreshSeats(room.id)
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'dohatti_rooms', filter: `id=eq.${room.id}` },
        (payload) => setRoom(payload.new)
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [room?.id, refreshSeats])

  async function run(action) {
    setError('')
    try {
      await action()
      await refreshSeats(room.id)
    } catch (e) {
      setError(e.message || 'Something went wrong.')
    }
  }

  const sit = (seat) =>
    run(async () => {
      const ok = await claimSeat(room.id, seat, me, getPlayerName())
      if (!ok) setError('Someone just took that seat.')
    })

  const toggleAI = (seat, makeAI) => run(() => setSeatAI(room.id, seat, makeAI))
  const fillAll = () => run(() => fillWithAI(room.id))
  const start = () => run(() => startGame(room.id))

  async function leave() {
    try {
      await leaveRoom(room, me)
    } finally {
      router.push('/games/dohatti')
    }
  }

  async function copyCode() {
    await navigator.clipboard.writeText(room.code)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  if (loading) {
    return <div className="flex-1 bg-black text-zinc-400 flex items-center justify-center">Loading…</div>
  }

  if (error && !room) {
    return (
      <div className="flex-1 bg-black text-zinc-100 flex flex-col items-center justify-center gap-4">
        <p className="text-red-400">{error}</p>
        <Link href="/games/dohatti" className="text-sky-300 hover:underline">
          ← Back to the lobby
        </Link>
      </div>
    )
  }

  const mySeat = seats.find((s) => s.player_id === me)
  const isHost = room.host_id === me
  const allFilled = seats.length === 4 && seats.every((s) => s.player_id || s.is_ai)

  return (
    <div className="flex-1 bg-black text-zinc-100 flex flex-col items-center gap-6 px-6 py-12">
      <h1 className="font-serif text-3xl text-sky-300">Do Hatti</h1>

      <div className="flex items-center gap-3">
        <span className="text-sm text-zinc-400">Room code</span>
        <span className="font-mono text-2xl tracking-[0.3em] text-emerald-200">{room.code}</span>
        <button
          onClick={copyCode}
          className="text-xs bg-zinc-800 hover:bg-zinc-700 rounded px-2 py-1 transition"
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>

      {room.status === 'playing' ? (
        <div className="bg-emerald-900/40 border border-emerald-700/30 rounded-2xl p-8 text-center">
          <p className="text-emerald-100 font-medium">The game has started.</p>
          <p className="text-xs text-emerald-300 mt-1">The card table is the next thing we build.</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-3 grid-rows-3 gap-3 w-full max-w-xl">
            {seats.map((s) => (
              <SeatCard
                key={s.seat}
                seat={s}
                isMe={s.player_id === me}
                isSeatHost={!!s.player_id && s.player_id === room.host_id}
                iAmSeated={!!mySeat}
                iAmHost={isHost}
                onSit={() => sit(s.seat)}
                onAddAI={() => toggleAI(s.seat, true)}
                onRemoveAI={() => toggleAI(s.seat, false)}
              />
            ))}
            <div className="col-start-2 row-start-2 flex flex-col items-center justify-center text-center text-[11px] text-zinc-500 gap-1">
              <span className="text-sky-400">Team A: bottom + top</span>
              <span className="text-amber-400">Team B: left + right</span>
              <span>Partners sit opposite each other</span>
            </div>
          </div>

          {error && <p className="text-sm text-red-400">{error}</p>}

          {isHost ? (
            <div className="flex flex-col items-center gap-3">
              <button
                onClick={fillAll}
                disabled={allFilled}
                className="text-sm bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 rounded-lg px-4 py-2 transition"
              >
                Fill empty seats with AI
              </button>
              <button
                onClick={start}
                disabled={!allFilled}
                className="bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 rounded-lg px-8 py-2 transition"
              >
                Start game
              </button>
              {!allFilled && (
                <p className="text-xs text-zinc-500">All 4 seats need a player or an AI to start.</p>
              )}
            </div>
          ) : (
            <p className="text-sm text-zinc-400">Waiting for the host to start the game…</p>
          )}
        </>
      )}

      <button onClick={leave} className="text-sm text-zinc-500 hover:text-zinc-300">
        Leave room
      </button>
    </div>
  )
}

function SeatCard({ seat, isMe, isSeatHost, iAmSeated, iAmHost, onSit, onAddAI, onRemoveAI }) {
  const team = seat.seat % 2 === 0 ? 'A' : 'B'
  const teamColor =
    team === 'A' ? 'border-sky-500/50 bg-sky-950/30' : 'border-amber-500/50 bg-amber-950/30'
  const isEmpty = !seat.player_id && !seat.is_ai

  return (
    <div
      className={`${SEAT_POSITION[seat.seat]} ${teamColor} border rounded-xl p-3 flex flex-col items-center justify-center gap-2 min-h-24 text-center`}
    >
      <span className="text-[10px] uppercase tracking-wide text-zinc-500">Team {team}</span>

      {seat.is_ai && <span className="text-sm">🤖 {seat.display_name}</span>}

      {seat.player_id && (
        <span className="text-sm">
          {isSeatHost && '👑 '}
          {seat.display_name}
          {isMe && <span className="text-emerald-300"> (you)</span>}
        </span>
      )}

      {isEmpty && <span className="text-sm text-zinc-500">Empty</span>}

      <div className="flex gap-1 flex-wrap justify-center">
        {isEmpty && iAmSeated && (
          <button
            onClick={onSit}
            className="text-xs bg-zinc-800 hover:bg-zinc-700 rounded px-2 py-1 transition"
          >
            Sit here
          </button>
        )}
        {isEmpty && iAmHost && (
          <button
            onClick={onAddAI}
            className="text-xs bg-zinc-800 hover:bg-zinc-700 rounded px-2 py-1 transition"
          >
            Add AI
          </button>
        )}
        {seat.is_ai && iAmHost && (
          <button
            onClick={onRemoveAI}
            className="text-xs bg-zinc-800 hover:bg-zinc-700 rounded px-2 py-1 transition"
          >
            Remove AI
          </button>
        )}
      </div>
    </div>
  )
}
