'use client'

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { getPlayerSecret } from '@/lib/dohattiIdentity'
import { postJson } from '@/lib/dohatti/api'
import {
  SUITS,
  SUIT_SYMBOL,
  SUIT_NAME,
  legalCards,
  suitOf,
  rankOf,
} from '@/lib/dohatti/engine'
import PlayingCard from '@/components/dohatti/PlayingCard'

// Screen position of a seat, relative to me (0 = me at the bottom).
const POS = {
  0: 'col-start-2 row-start-3',
  1: 'col-start-1 row-start-2',
  2: 'col-start-2 row-start-1',
  3: 'col-start-3 row-start-2',
}

export default function Table({ room, seats, me, isHost }) {
  const [game, setGame] = useState(null)
  const [hand, setHand] = useState([])
  const [myTrump, setMyTrump] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const mySeat = seats.find((s) => s.player_id === me)?.seat ?? 0
  const myTeam = mySeat % 2 === 0 ? 'A' : 'B'
  const nameOf = (seat) => seats.find((s) => s.seat === seat)?.display_name || `Seat ${seat + 1}`
  const screenPos = (seat) => (seat - mySeat + 4) % 4

  const applyState = useCallback((incoming) => {
    setGame((prev) => (!prev || (incoming.version ?? 0) >= (prev.version ?? 0) ? incoming : prev))
  }, [])

  const fetchHand = useCallback(async () => {
    try {
      const data = await postJson('/api/dohatti/hand', {
        roomId: room.id,
        secret: getPlayerSecret(),
      })
      setHand(data.hand)
      setMyTrump(data.trump)
    } catch (e) {
      setError(e.message)
    }
  }, [room.id])

  // Public game state: first load + live updates
  useEffect(() => {
    let cancelled = false
    supabase
      .from('dohatti_games')
      .select('state')
      .eq('room_id', room.id)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled && data) applyState(data.state)
      })

    const channel = supabase
      .channel(`dohatti-game-${room.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'dohatti_games', filter: `room_id=eq.${room.id}` },
        (payload) => {
          if (payload.new?.state) applyState(payload.new.state)
        }
      )
      .subscribe()

    return () => {
      cancelled = true
      supabase.removeChannel(channel)
    }
  }, [room.id, applyState])

  // My private hand: reload whenever the public state changes
  useEffect(() => {
    fetchHand()
  }, [game?.version, fetchHand])

  // Safety net: if a bot should move but nothing happens for 5 seconds, the host nudges the server.
  useEffect(() => {
    if (!isHost || !game || game.phase === 'finished') return
    const actor = seats.find((s) => s.seat === game.turn)
    if (!actor?.is_ai) return
    const timer = setTimeout(() => {
      postJson('/api/dohatti/action', {
        roomId: room.id,
        secret: getPlayerSecret(),
        type: 'kick',
      }).catch(() => {})
    }, 5000)
    return () => clearTimeout(timer)
  }, [isHost, game, seats, room.id])

  async function act(url, body) {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await postJson(url, { roomId: room.id, secret: getPlayerSecret(), ...body })
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  if (!game) {
    return <p className="text-zinc-400">Dealing the cards…</p>
  }

  const myTurn = game.turn === mySeat
  const choosingTrump = game.phase === 'choosing_trump'
  const finished = game.phase === 'finished'
  const legal = !finished && !choosingTrump && myTurn ? legalCards(hand, game.trick) : []

  const sortedHand = [...hand].sort(
    (a, b) => SUITS.indexOf(suitOf(a)) - SUITS.indexOf(suitOf(b)) || rankOf(b) - rankOf(a)
  )

  const tableCards = game.trick.length > 0 ? game.trick : game.lastTrick?.cards || []
  const showingLast = game.trick.length === 0 && !!game.lastTrick

  let status
  if (finished) {
    status = game.winner === myTeam ? 'Your team wins!' : 'The other team wins.'
  } else if (choosingTrump) {
    status = myTurn ? 'Choose the trump suit' : `Waiting for ${nameOf(game.caller)} to choose trump…`
  } else {
    status = myTurn ? 'Your turn' : `Waiting for ${nameOf(game.turn)}…`
  }

  return (
    <div className="w-full max-w-2xl flex flex-col items-center gap-5">
      {/* Info bar */}
      <div className="w-full flex flex-wrap items-center justify-between gap-3 text-sm bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-2">
        <div>
          <span className="text-zinc-400">Trump: </span>
          {game.trumpRevealed ? (
            <span className="font-semibold">
              <SuitText suit={game.trump} /> {SUIT_NAME[game.trump]}
              <span className="text-xs text-zinc-500"> (revealed by {nameOf(game.revealedBy)})</span>
            </span>
          ) : myTrump ? (
            <span className="font-semibold">
              <SuitText suit={myTrump} /> {SUIT_NAME[myTrump]}
              <span className="text-xs text-zinc-500"> (hidden, only you know)</span>
            </span>
          ) : (
            <span className="text-zinc-300">hidden</span>
          )}
        </div>
        <div className="flex gap-4">
          <span className={myTeam === 'A' ? 'text-sky-300 font-semibold' : 'text-zinc-400'}>
            Team A: {game.tricksWon[0]}
          </span>
          <span className={myTeam === 'B' ? 'text-amber-300 font-semibold' : 'text-zinc-400'}>
            Team B: {game.tricksWon[1]}
          </span>
        </div>
      </div>

      {/* Table */}
      <div className="grid grid-cols-3 grid-rows-3 gap-2 w-full">
        {[0, 1, 2, 3].map((seat) => (
          <SeatBadge
            key={seat}
            position={POS[screenPos(seat)]}
            name={nameOf(seat)}
            isMe={seat === mySeat}
            isBot={!!seats.find((s) => s.seat === seat)?.is_ai}
            team={seat % 2 === 0 ? 'A' : 'B'}
            active={!finished && game.turn === seat}
            isCaller={seat === game.caller}
            cardsLeft={game.handSizes[seat]}
          />
        ))}

        {/* Middle: cards of the current trick */}
        <div className="col-start-2 row-start-2 relative min-h-44">
          <div
            className={`absolute inset-0 grid grid-cols-3 grid-rows-3 place-items-center ${
              showingLast ? 'opacity-50' : ''
            }`}
          >
            {tableCards.map((play) => (
              <div key={`${play.seat}-${play.card}`} className={POS[screenPos(play.seat)]}>
                <PlayingCard card={play.card} />
              </div>
            ))}
          </div>
          {showingLast && (
            <p className="absolute -bottom-1 w-full text-center text-[10px] text-zinc-500">
              Last trick won by {nameOf(game.lastTrick.winner)}
            </p>
          )}
        </div>
      </div>

      {/* Status */}
      <p className={`text-lg font-medium ${myTurn && !finished ? 'text-emerald-300' : 'text-zinc-300'}`}>
        {status}
      </p>
      {error && <p className="text-sm text-red-400">{error}</p>}

      {/* Trump choice */}
      {choosingTrump && myTurn && (
        <div className="flex gap-3">
          {SUITS.map((suit) => (
            <button
              key={suit}
              disabled={busy}
              onClick={() => act('/api/dohatti/action', { type: 'trump', suit })}
              className="w-16 h-16 text-3xl rounded-xl bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 transition"
            >
              <SuitText suit={suit} light />
            </button>
          ))}
        </div>
      )}

      {/* Finished */}
      {finished && (
        <div className="flex flex-col items-center gap-2">
          <p className="text-sm text-zinc-400">
            Final: Team A {game.tricksWon[0]} – Team B {game.tricksWon[1]}
          </p>
          {isHost ? (
            <button
              onClick={() => act('/api/dohatti/start', {})}
              disabled={busy}
              className="bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 rounded-lg px-6 py-2 transition"
            >
              Deal again
            </button>
          ) : (
            <p className="text-xs text-zinc-500">Waiting for the host to deal again…</p>
          )}
        </div>
      )}

      {/* My hand */}
      <div className="flex flex-wrap justify-center gap-1.5 pt-2">
        {sortedHand.map((card) => (
          <PlayingCard
            key={card}
            card={card}
            onClick={
              !finished && !choosingTrump
                ? () => act('/api/dohatti/action', { type: 'play', card })
                : undefined
            }
            disabled={busy || !legal.includes(card)}
          />
        ))}
      </div>
    </div>
  )
}

function SuitText({ suit, light = false }) {
  const red = suit === 'H' || suit === 'D'
  const color = red ? 'text-red-500' : light ? 'text-zinc-100' : 'text-zinc-100'
  return <span className={color}>{SUIT_SYMBOL[suit]}</span>
}

function SeatBadge({ position, name, isMe, isBot, team, active, isCaller, cardsLeft }) {
  const teamColor = team === 'A' ? 'border-sky-500/50' : 'border-amber-500/50'
  return (
    <div
      className={`${position} ${teamColor} ${
        active ? 'ring-2 ring-emerald-400 bg-emerald-950/40' : 'bg-zinc-900'
      } border rounded-xl px-2 py-2 flex flex-col items-center justify-center text-center gap-0.5`}
    >
      <span className="text-sm">
        {isBot && '🤖 '}
        {name}
        {isMe && <span className="text-emerald-300"> (you)</span>}
      </span>
      <span className="text-[10px] text-zinc-500">
        Team {team} · {cardsLeft} cards{isCaller ? ' · 🎯 caller' : ''}
      </span>
    </div>
  )
}
