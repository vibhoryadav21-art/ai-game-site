'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabaseClient'
import { ensureIdentity, getPlayerName, getPlayerSecret } from '@/lib/dohattiIdentity'
import { postJson } from '@/lib/dohatti/api'
import {
  getRoomByCode,
  getSeats,
  claimSeat,
  setSeatAI,
  fillWithAI,
  leaveRoom,
} from '@/lib/dohattiRooms'
import Table from '@/components/dohatti/Table'

// Screen position relative to me: I sit at the TOP, my partner at the BOTTOM,
// the next seat on my right, the last seat on my left (same as the game table).
const SEAT_POSITION = {
  0: 'col-start-2 row-start-1',
  1: 'col-start-3 row-start-2',
  2: 'col-start-2 row-start-3',
  3: 'col-start-1 row-start-2',
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
      const name = getPlayerName()
      if (!name) {
        router.replace(`/games/dohatti?code=${code}`)
        return
      }
      const playerId = await ensureIdentity()
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
  const start = () =>
    run(() => postJson('/api/dohatti/start', { roomId: room.id, secret: getPlayerSecret() }))

  async function leave() {
    const message =
      room.status === 'playing'
        ? 'Leave the game? A bot will take your seat.'
        : 'Leave this room?'
    if (!window.confirm(message)) return
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
  const myIdx = mySeat?.seat ?? 0
  const isHost = room.host_id === me
  const allFilled = seats.length === 4 && seats.every((s) => s.player_id || s.is_ai)
  const nameAt = (seat) => seats.find((s) => s.seat === seat)?.display_name || '—'
  const partnerIdx = (myIdx + 2) % 4

  return (
    <div className="relative flex-1 bg-black text-zinc-100 flex flex-col items-center gap-4 px-3 py-4 text-base">
      {/* Leave: red icon, top right */}
      <button
        onClick={leave}
        aria-label="Leave room"
        title="Leave room"
        className="absolute top-3 right-3 z-20 w-11 h-11 rounded-full border-2 border-red-700 bg-black text-red-500 hover:bg-red-950 flex items-center justify-center transition"
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
          <polyline points="16 17 21 12 16 7" />
          <line x1="21" y1="12" x2="9" y2="12" />
        </svg>
      </button>

      {room.status === 'playing' ? (
        <Table room={room} seats={seats} me={me} isHost={isHost} />
      ) : (
        <>
          {/* Start controls first, so they are always visible on a phone */}
          {isHost ? (
            <div className="w-full max-w-sm flex flex-col items-center gap-2">
              <button
                onClick={start}
                disabled={!allFilled}
                className="w-full bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 rounded-xl py-3.5 text-xl transition"
              >
                Start game
              </button>
              <button
                onClick={fillAll}
                disabled={allFilled}
                className="text-base bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 rounded-lg px-4 py-2.5 transition"
              >
                Fill empty seats with AI
              </button>
              {!allFilled && (
                <p className="text-sm text-zinc-500">All 4 seats need a player or an AI to start.</p>
              )}
            </div>
          ) : (
            <p className="text-base text-zinc-400">Waiting for the host to start the game…</p>
          )}

          {/* Who is on which team */}
          <div className="w-full max-w-sm flex flex-col gap-1 text-base bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2.5">
            <span className="text-sky-300">
              Your team: {nameAt(myIdx)} + {nameAt(partnerIdx)}
            </span>
            <span className="text-amber-300">
              Opponents: {nameAt((myIdx + 1) % 4)} + {nameAt((myIdx + 3) % 4)}
            </span>
          </div>

          <div className="grid grid-cols-3 grid-rows-3 gap-2 w-full max-w-sm">
            {seats.map((s) => {
              const pos = (s.seat - myIdx + 4) % 4
              return (
                <SeatCard
                  key={s.seat}
                  seat={s}
                  positionClass={SEAT_POSITION[pos]}
                  tag={pos === 0 ? 'You' : pos === 2 ? 'Partner' : 'Opponent'}
                  mine={pos === 0 || pos === 2}
                  isMe={s.player_id === me}
                  isSeatHost={!!s.player_id && s.player_id === room.host_id}
                  iAmSeated={!!mySeat}
                  iAmHost={isHost}
                  onSit={() => sit(s.seat)}
                  onAddAI={() => toggleAI(s.seat, true)}
                  onRemoveAI={() => toggleAI(s.seat, false)}
                />
              )
            })}
          </div>
          <p className="text-sm text-zinc-500 text-center max-w-sm">
            Tap "Sit here" on an empty seat to move. Partners sit opposite each other.
          </p>

          {error && <p className="text-base text-red-400">{error}</p>}
        </>
      )}

      {room.status === 'playing' && error && <p className="text-base text-red-400">{error}</p>}

      {/* Room code: only needed while people are still joining */}
      {room.status !== 'playing' && (
        <div className="w-full max-w-sm flex flex-col items-center gap-2 border-t border-zinc-800 pt-4 mt-2">
          <div className="flex items-center gap-3">
            <span className="text-sm text-zinc-500">Room code</span>
            <span className="font-mono text-2xl tracking-[0.3em] text-emerald-200">{room.code}</span>
            <button
              onClick={copyCode}
              className="text-sm bg-zinc-800 hover:bg-zinc-700 rounded px-3 py-1.5 transition"
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function SeatCard({
  seat,
  positionClass,
  tag,
  mine,
  isMe,
  isSeatHost,
  iAmSeated,
  iAmHost,
  onSit,
  onAddAI,
  onRemoveAI,
}) {
  const teamColor = mine ? 'border-sky-500/60 bg-sky-950/30' : 'border-amber-500/60 bg-amber-950/30'
  const tagColor = mine ? 'text-sky-300' : 'text-amber-300'
  const isEmpty = !seat.player_id && !seat.is_ai

  return (
    <div
      className={`${positionClass} ${teamColor} border-2 rounded-xl p-2 flex flex-col items-center justify-center gap-1.5 min-h-24 text-center`}
    >
      <span className={`text-xs font-semibold uppercase tracking-wide ${tagColor}`}>{tag}</span>

      {seat.is_ai && <span className="text-base">🤖 {seat.display_name}</span>}

      {seat.player_id && (
        <span className="text-base leading-tight">
          {isSeatHost && '👑 '}
          {seat.display_name}
          {isMe && <span className="text-emerald-300"> (you)</span>}
        </span>
      )}

      {isEmpty && <span className="text-base text-zinc-500">Empty</span>}

      <div className="flex gap-1 flex-wrap justify-center">
        {isEmpty && iAmSeated && (
          <button
            onClick={onSit}
            className="text-sm bg-zinc-800 hover:bg-zinc-700 rounded px-2.5 py-1.5 transition"
          >
            Sit here
          </button>
        )}
        {isEmpty && iAmHost && (
          <button
            onClick={onAddAI}
            className="text-sm bg-zinc-800 hover:bg-zinc-700 rounded px-2.5 py-1.5 transition"
          >
            Add AI
          </button>
        )}
        {seat.is_ai && iAmHost && (
          <button
            onClick={onRemoveAI}
            className="text-sm bg-zinc-800 hover:bg-zinc-700 rounded px-2.5 py-1.5 transition"
          >
            Remove AI
          </button>
        )}
      </div>
    </div>
  )
}
