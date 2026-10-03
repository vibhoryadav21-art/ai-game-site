'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabaseClient'
import { ensureIdentity, getPlayerName, getPlayerSecret } from '@/lib/dohattiIdentity'
import { postJson } from '@/lib/dohatti/api'
import { useDohattiText } from '@/lib/dohattiText'
import {
  getRoomByCode,
  getSeats,
  claimSeat,
  setSeatAI,
  fillWithAI,
  leaveRoom,
} from '@/lib/dohattiRooms'
import Table from '@/components/dohatti/Table'
import BotRisk, { RISK_ICON } from '@/components/dohatti/BotRisk'
import { BOT_RISKS } from '@/lib/dohatti/engine'
import { HEARTBEAT_MS } from '@/lib/dohatti/presence'

// Screen position relative to me: I sit at the BOTTOM, my partner at the TOP,
// the next seat on my left, the last seat on my right (same as the game table).
const SEAT_POSITION = {
  0: 'col-start-2 row-start-3',
  1: 'col-start-1 row-start-2',
  2: 'col-start-2 row-start-1',
  3: 'col-start-3 row-start-2',
}

export default function DoHattiRoomPage() {
  const { t, tr } = useDohattiText()
  const { code } = useParams()
  const router = useRouter()
  const [me, setMe] = useState(null)
  const [room, setRoom] = useState(null)
  const [seats, setSeats] = useState([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState(false)
  const startedRef = useRef(false)

  const refreshSeats = useCallback(
    async (roomId) => {
      try {
        setSeats(await getSeats(roomId))
      } catch {
        setError(t.couldNotLoadSeats)
      }
    },
    [t.couldNotLoadSeats]
  )

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
          setError(t.roomNotFound)
          setLoading(false)
          return
        }

        let current = await getSeats(r.id)
        const alreadySeated = current.some((s) => s.player_id === playerId)

        if (!alreadySeated) {
          if (r.status !== 'waiting') {
            setError(t.gameAlreadyStarted)
            setLoading(false)
            return
          }
          const empty = current.find((s) => !s.player_id && !s.is_ai)
          if (!empty) {
            setError(t.roomFull)
            setLoading(false)
            return
          }
          await claimSeat(r.id, empty.seat, playerId, name)
          current = await getSeats(r.id)
          if (!current.some((s) => s.player_id === playerId)) {
            setError(t.seatJustTaken)
            setLoading(false)
            return
          }
        }

        setRoom(r)
        setSeats(current)
        setLoading(false)
      } catch (e) {
        setError(e.message || t.somethingWrong)
        setLoading(false)
      }
    }

    init()
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // Heartbeat: tell the server "I am still here" while this page is visible.
  // If the heartbeat stops (tab closed, phone locked, no network), a bot plays on my turn.
  useEffect(() => {
    if (!room?.id || !me) return
    const secret = getPlayerSecret()
    const ping = () => {
      if (document.visibilityState === 'visible') {
        postJson('/api/dohatti/ping', { roomId: room.id, secret }).catch(() => {})
      }
    }
    ping()
    const timer = setInterval(ping, HEARTBEAT_MS)
    document.addEventListener('visibilitychange', ping)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', ping)
    }
  }, [room?.id, me])

  async function run(action) {
    setError('')
    try {
      await action()
      await refreshSeats(room.id)
    } catch (e) {
      setError(e.message || t.somethingWrong)
    }
  }

  const sit = (seat) =>
    run(async () => {
      const ok = await claimSeat(room.id, seat, me, getPlayerName())
      if (!ok) setError(t.someoneTookSeat)
    })

  const toggleAI = (seat, makeAI) => run(() => setSeatAI(room.id, seat, makeAI))
  const fillAll = () => run(() => fillWithAI(room.id))
  const start = () =>
    run(() => postJson('/api/dohatti/start', { roomId: room.id, secret: getPlayerSecret() }))

  async function leave() {
    const message = room.status === 'playing' ? t.leaveConfirmPlaying : t.leaveConfirmWaiting
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
    return <div className="flex-1 bg-black text-zinc-400 flex items-center justify-center">{t.loading}</div>
  }

  if (error && !room) {
    return (
      <div className="flex-1 bg-black text-zinc-100 flex flex-col items-center justify-center gap-4 px-4 text-center text-base">
        <p className="text-red-400">{error}</p>
        <Link href="/games/dohatti" className="text-sky-300 hover:underline">
          {t.backToLobby}
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
    <div className="flex-1 bg-black text-zinc-100 flex flex-col items-center gap-3 px-3 py-3 text-base">
      <style>{`@keyframes dh-pop { 0% { opacity: 0; transform: scale(.5); } 60% { opacity: 1; transform: scale(1.2); } 100% { transform: scale(1); } } .dh-pop { animation: dh-pop .45s ease-out both; } @media (prefers-reduced-motion: reduce) { .dh-pop { animation: none !important; } }`}</style>

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
                className="w-full bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 rounded-xl py-3.5 text-xl transition active:scale-95"
              >
                {t.startGame}
              </button>
              <button
                onClick={fillAll}
                disabled={allFilled}
                className="text-base bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 rounded-lg px-4 py-2.5 transition active:scale-95"
              >
                {t.fillWithAI}
              </button>
              {!allFilled && <p className="text-sm text-zinc-500 text-center">{t.needAllSeats}</p>}
            </div>
          ) : (
            <p className="text-base text-zinc-400">{t.waitingForHost}</p>
          )}

          {/* Who is on which team */}
          <div className="w-full max-w-sm flex flex-col gap-1 text-base bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2.5">
            <span className="text-sky-300">{t.yourTeamNames(nameAt(myIdx), nameAt(partnerIdx))}</span>
            <span className="text-amber-300">
              {t.opponentsNames(nameAt((myIdx + 1) % 4), nameAt((myIdx + 3) % 4))}
            </span>
          </div>

          <div dir="ltr" className="grid grid-cols-3 grid-rows-3 gap-2 w-full max-w-sm">
            {seats.map((s) => {
              const pos = (s.seat - myIdx + 4) % 4
              return (
                <SeatCard
                  key={s.seat}
                  seat={s}
                  t={t}
                  risk={BOT_RISKS.includes(room.bot_risk) ? room.bot_risk : 'normal'}
                  positionClass={SEAT_POSITION[pos]}
                  tag={pos === 0 ? t.tagYou : pos === 2 ? t.tagPartner : t.tagOpponent}
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
          <p className="text-sm text-zinc-500 text-center max-w-sm">{t.seatHint}</p>

          <div className="w-full max-w-sm">
            <BotRisk room={room} isHost={isHost} t={t} />
          </div>
        </>
      )}

      {error && <p className="text-base text-red-400 text-center">{tr(error)}</p>}

      {/* Room code: only needed while people are still joining */}
      {room.status !== 'playing' && (
        <div className="w-full max-w-sm flex flex-col items-center gap-2 border-t border-zinc-800 pt-4 mt-2">
          <div className="flex items-center gap-3">
            <span className="text-sm text-zinc-500">{t.roomCode}</span>
            <span dir="ltr" className="font-mono text-2xl tracking-[0.3em] text-emerald-200">
              {room.code}
            </span>
            <button
              onClick={copyCode}
              className="text-sm bg-zinc-800 hover:bg-zinc-700 rounded px-3 py-1.5 transition active:scale-95"
            >
              {copied ? t.copied : t.copy}
            </button>
          </div>
        </div>
      )}

      {/* Leave: red icon, bottom left */}
      <div dir="ltr" className="w-full max-w-md flex justify-start pt-1">
        <button
          onClick={leave}
          aria-label={t.leave}
          title={t.leave}
          className="w-11 h-11 rounded-full border-2 border-red-700 bg-black text-red-500 hover:bg-red-950 flex items-center justify-center transition active:scale-95"
        >
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <polyline points="16 17 21 12 16 7" />
            <line x1="21" y1="12" x2="9" y2="12" />
          </svg>
        </button>
      </div>
    </div>
  )
}

function SeatCard({
  seat,
  t,
  risk,
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

      {seat.is_ai && (
        <span className="text-base">
          🤖 {seat.display_name} <span title={risk}>{RISK_ICON[risk]}</span>
        </span>
      )}

      {seat.player_id && (
        <span key={seat.display_name} className="dh-pop text-base leading-tight">
          {isSeatHost && '👑 '}
          {seat.display_name}
          {isMe && <span className="text-emerald-300"> {t.you}</span>}
        </span>
      )}

      {isEmpty && <span className="text-base text-zinc-500">{t.empty}</span>}

      <div className="flex gap-1 flex-wrap justify-center">
        {isEmpty && iAmSeated && (
          <button
            onClick={onSit}
            className="text-sm bg-zinc-800 hover:bg-zinc-700 rounded px-2.5 py-1.5 transition active:scale-95"
          >
            {t.sitHere}
          </button>
        )}
        {isEmpty && iAmHost && (
          <button
            onClick={onAddAI}
            className="text-sm bg-zinc-800 hover:bg-zinc-700 rounded px-2.5 py-1.5 transition active:scale-95"
          >
            {t.addAI}
          </button>
        )}
        {seat.is_ai && iAmHost && (
          <button
            onClick={onRemoveAI}
            className="text-sm bg-zinc-800 hover:bg-zinc-700 rounded px-2.5 py-1.5 transition active:scale-95"
          >
            {t.removeAI}
          </button>
        )}
      </div>
    </div>
  )
}
