'use client'

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { getPlayerSecret } from '@/lib/dohattiIdentity'
import { postJson } from '@/lib/dohatti/api'
import {
  BIDS,
  SUITS,
  SUIT_SYMBOL,
  SUIT_NAME,
  legalCards,
  suitOf,
  rankOf,
} from '@/lib/dohatti/engine'
import PlayingCard from '@/components/dohatti/PlayingCard'

const RANK_LABEL = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' }
const cardText = (card) => `${RANK_LABEL[rankOf(card)] || rankOf(card)}${SUIT_SYMBOL[suitOf(card)]}`
const teamName = (team) => (team === 0 ? 'A' : 'B')

const SOURCE_LABEL = {
  llm: 'AI model',
  rules: 'rule bot',
  'rules-fallback': 'rule bot (AI model failed)',
}

// Position inside the little trick area, relative to me (0 = me at the bottom).
const TRICK_POS = {
  0: 'col-start-2 row-start-3',
  1: 'col-start-1 row-start-2',
  2: 'col-start-2 row-start-1',
  3: 'col-start-3 row-start-2',
}

function formatDuration(totalSeconds) {
  const s = Math.max(0, totalSeconds)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const mm = String(m).padStart(2, '0')
  const ss = String(sec).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`
}

// A clock value that updates every second.
function useNow() {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  return now
}

export default function Table({ room, seats, me, isHost }) {
  const [game, setGame] = useState(null)
  const [hand, setHand] = useState([])
  const [hiddenCard, setHiddenCard] = useState(null)
  const [selected, setSelected] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const now = useNow()

  const mySeat = seats.find((s) => s.player_id === me)?.seat ?? 0
  const myTeam = mySeat % 2
  const nameOf = (seat) => seats.find((s) => s.seat === seat)?.display_name || `Seat ${seat + 1}`
  const screenPos = (seat) => (seat - mySeat + 4) % 4
  const seatAt = (pos) => (mySeat + pos) % 4

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
      setHiddenCard(data.trumpCard)
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

  // A new game starts: forget the card I had selected
  useEffect(() => {
    setSelected(null)
  }, [game?.gameNo])

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
  const action = (body) => act('/api/dohatti/action', body)

  if (!game) {
    return <p className="text-zinc-400 text-sm">Dealing the cards…</p>
  }

  const { phase } = game
  const bidding = phase === 'bidding'
  const choosing = phase === 'choosing_trump'
  const playing = phase === 'playing'
  const finished = phase === 'finished'
  const myTurn = !finished && game.turn === mySeat
  const iAmCaller = game.caller === mySeat
  const legal = playing && myTurn ? legalCards(hand, game.trick) : []

  const sortedHand = [...hand].sort(
    (a, b) => SUITS.indexOf(suitOf(a)) - SUITS.indexOf(suitOf(b)) || rankOf(b) - rankOf(a)
  )

  const matchSeconds = Math.floor((now - game.matchStartedAt) / 1000)
  const gameSeconds = Math.floor(((finished ? game.finishedAt : now) - game.gameStartedAt) / 1000)

  const tableCards = game.trick.length > 0 ? game.trick : game.lastTrick?.cards || []
  const showingLast = game.trick.length === 0 && !!game.lastTrick && playing

  const bids = game.bidding
  const currentBid = bids.current
  const isFirstBidder = bids.index === 0

  // ---- status line ----
  let status
  if (finished) {
    status = game.result.made
      ? `Team ${teamName(game.result.callingTeam)} made the bid`
      : `Team ${teamName(game.result.callingTeam)} missed the bid`
  } else if (bidding) {
    status = myTurn ? 'Your bid' : `Waiting for ${nameOf(game.turn)} to bid…`
  } else if (choosing) {
    status = iAmCaller ? 'Pick your hidden trump card' : `${nameOf(game.caller)} is choosing the trump card…`
  } else {
    status = myTurn ? 'Your turn' : `Waiting for ${nameOf(game.turn)}…`
  }

  // ---- what happens when I tap a card ----
  function cardHandler(card) {
    if (choosing && iAmCaller) return () => setSelected(card)
    if (playing) return () => action({ type: 'play', card })
    return undefined
  }
  const cardDisabled = (card) => {
    if (choosing) return busy
    return busy || !legal.includes(card)
  }

  return (
    <div className="w-full max-w-md flex flex-col items-center gap-3">
      {/* Slim info strip */}
      <div className="w-full text-[11px] bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 flex flex-col gap-1">
        <div className="flex justify-between text-zinc-400">
          <span>
            ⏱ {formatDuration(matchSeconds)} · Game {game.gameNo} ({formatDuration(gameSeconds)})
          </span>
          <span>
            Courts A {game.courts[0]} – B {game.courts[1]}
          </span>
        </div>
        <div className="flex flex-wrap justify-between gap-x-3 gap-y-0.5 text-zinc-300">
          <span>
            Tally{' '}
            <span className={game.scores[0] < 0 ? 'text-red-400' : ''}>A {game.scores[0]}</span> ·{' '}
            <span className={game.scores[1] < 0 ? 'text-red-400' : ''}>B {game.scores[1]}</span>
          </span>
          {game.bid && (
            <span>
              Bid: Team {teamName(game.callingTeam)} {game.bid}
            </span>
          )}
        </div>
        {game.bid && (
          <div className="flex flex-wrap justify-between gap-x-3 gap-y-0.5 text-zinc-300">
            <span>
              Points A {game.points[0]} – B {game.points[1]} · Pile {game.pot}
            </span>
            <span>
              Trump:{' '}
              {game.trumpRevealed ? (
                <span className="font-semibold">
                  {SUIT_SYMBOL[game.trump]} {SUIT_NAME[game.trump]}
                </span>
              ) : hiddenCard ? (
                <span className="font-semibold">{SUIT_SYMBOL[suitOf(hiddenCard)]} (hidden)</span>
              ) : (
                'hidden'
              )}
            </span>
          </div>
        )}
      </div>

      {/* Status */}
      <p className={`text-base font-medium ${myTurn ? 'text-emerald-300' : 'text-zinc-300'}`}>{status}</p>
      {game.aiNote && !finished && (
        <p className="text-[11px] text-zinc-500 text-center -mt-2">
          🤖 {nameOf(game.aiNote.seat)}{' '}
          {game.aiNote.kind === 'bid'
            ? game.aiNote.bid === 'pass'
              ? 'passed'
              : `bid ${game.aiNote.bid}`
            : game.aiNote.kind === 'trump'
              ? 'hid the trump card'
              : `played ${cardText(game.aiNote.card)}`}{' '}
          · {SOURCE_LABEL[game.aiNote.source] || game.aiNote.source}
          {game.aiNote.text ? ` · “${game.aiNote.text}”` : ''}
        </p>
      )}
      {error && <p className="text-sm text-red-400">{error}</p>}

      {/* ME + MY CARDS, at the top */}
      <div
        className={`w-full rounded-xl border px-2 py-2 flex flex-col items-center gap-2 ${
          myTeam === 0 ? 'border-sky-500/50' : 'border-amber-500/50'
        } ${myTurn ? 'ring-2 ring-emerald-400 bg-emerald-950/30' : 'bg-zinc-900'}`}
      >
        <div className="w-full flex items-center justify-between text-xs px-1">
          <span>
            {nameOf(mySeat)} <span className="text-emerald-300">(you)</span> · Team {teamName(myTeam)}
            {game.dealer === mySeat ? ' · 🃏 dealer' : ''}
            {iAmCaller ? ' · 🎯 caller' : ''}
          </span>
          <span className="text-zinc-500">{game.handSizes[mySeat]} cards</span>
        </div>
        <div className="flex flex-wrap justify-center gap-1">
          {sortedHand.map((card) => (
            <PlayingCard
              key={card}
              card={card}
              selected={choosing && selected === card}
              onClick={cardHandler(card)}
              disabled={cardDisabled(card)}
            />
          ))}
        </div>
      </div>

      {/* Actions */}
      {bidding && (
        <div className="w-full flex flex-col items-center gap-2">
          {bids.history.length > 0 && (
            <p className="text-xs text-zinc-400 text-center">
              {bids.history.map((h) => `${nameOf(h.seat)}: ${h.bid}`).join(' · ')}
            </p>
          )}
          {myTurn && (
            <>
              <p className="text-xs text-zinc-400">
                {currentBid === null
                  ? 'Choose how many tricks your team will collect.'
                  : `Current bid: ${currentBid}. Raise it or pass.`}{' '}
                Missing your bid costs double.
              </p>
              <div className="flex flex-wrap justify-center gap-2">
                {BIDS.map((b) => (
                  <button
                    key={b}
                    disabled={busy || (currentBid !== null && b <= currentBid)}
                    onClick={() => action({ type: 'bid', amount: b })}
                    className="w-16 h-12 text-lg rounded-xl bg-emerald-800 hover:bg-emerald-700 disabled:opacity-30 transition"
                  >
                    {b}
                  </button>
                ))}
                {!isFirstBidder && (
                  <button
                    disabled={busy}
                    onClick={() => action({ type: 'bid', amount: 'pass' })}
                    className="px-4 h-12 rounded-xl bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 transition"
                  >
                    Pass
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {choosing && iAmCaller && (
        <div className="flex flex-col items-center gap-2">
          <p className="text-xs text-zinc-400 text-center">
            Tap one of your cards. It is set aside face down and its suit becomes trump. You cannot play it
            until trump is revealed.
          </p>
          <button
            disabled={busy || !selected}
            onClick={() => action({ type: 'trump', card: selected })}
            className="bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 rounded-lg px-6 py-2 transition"
          >
            {selected ? `Hide ${cardText(selected)} as trump` : 'Select a card'}
          </button>
        </div>
      )}

      {playing && iAmCaller && !game.trumpRevealed && hiddenCard && (
        <div className="flex items-center gap-3 text-xs bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2">
          <span className="text-zinc-400">
            Hidden trump card: <span className="font-semibold text-zinc-100">{cardText(hiddenCard)}</span>
          </span>
          <button
            disabled={busy}
            onClick={() => action({ type: 'reveal' })}
            className="bg-sky-700 hover:bg-sky-600 disabled:opacity-50 rounded px-3 py-1.5 transition"
          >
            Reveal trump
          </button>
        </div>
      )}

      {finished && <FinishedPanel game={game} nameOf={nameOf} isHost={isHost} busy={busy} onDeal={() => act('/api/dohatti/start', {})} />}

      {/* Table: opponents and the cards in play */}
      {!bidding && !choosing && (
        <div className="w-full flex flex-col items-center gap-1.5">
          <SeatChip seat={seatAt(2)} game={game} seats={seats} nameOf={nameOf} />
          <div className="w-full flex items-stretch gap-1.5">
            <SeatChip seat={seatAt(1)} game={game} seats={seats} nameOf={nameOf} />
            <div className="relative flex-1 min-h-40">
              <div
                className={`absolute inset-0 grid grid-cols-3 grid-rows-3 place-items-center ${
                  showingLast ? 'opacity-50' : ''
                }`}
              >
                {tableCards.map((play) => (
                  <div key={`${play.seat}-${play.card}`} className={TRICK_POS[screenPos(play.seat)]}>
                    <PlayingCard card={play.card} size="sm" />
                  </div>
                ))}
              </div>
            </div>
            <SeatChip seat={seatAt(3)} game={game} seats={seats} nameOf={nameOf} />
          </div>
          {showingLast && (
            <p className="text-[10px] text-zinc-500">Last trick won by {nameOf(game.lastTrick.winner)}</p>
          )}
        </div>
      )}

      {(bidding || choosing) && (
        <div className="w-full flex justify-center gap-1.5 flex-wrap">
          {[1, 2, 3].map((pos) => (
            <SeatChip key={pos} seat={seatAt(pos)} game={game} seats={seats} nameOf={nameOf} wide />
          ))}
        </div>
      )}
    </div>
  )
}

function SeatChip({ seat, game, seats, nameOf, wide = false }) {
  const row = seats.find((s) => s.seat === seat)
  const team = seat % 2
  const active = game.phase !== 'finished' && game.turn === seat
  return (
    <div
      className={`${wide ? 'w-28' : 'w-20'} ${
        team === 0 ? 'border-sky-500/50' : 'border-amber-500/50'
      } ${active ? 'ring-2 ring-emerald-400 bg-emerald-950/40' : 'bg-zinc-900'} border rounded-lg px-1.5 py-1.5 flex flex-col items-center justify-center text-center`}
    >
      <span className="text-[11px] leading-tight w-full truncate">
        {row?.is_ai ? '🤖 ' : ''}
        {nameOf(seat)}
      </span>
      <span className="text-[10px] text-zinc-500 leading-tight">
        {game.handSizes[seat]} cards
        {game.dealer === seat ? ' · 🃏' : ''}
        {game.caller === seat ? ' · 🎯' : ''}
      </span>
    </div>
  )
}

function FinishedPanel({ game, nameOf, isHost, busy, onDeal }) {
  const r = game.result
  const callTeam = teamName(r.callingTeam)
  return (
    <div className="w-full flex flex-col items-center gap-2 bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-center">
      <p className="text-sm">
        {r.made ? (
          <>
            Team {callTeam} bid {r.bid} and collected {r.callingPoints}:{' '}
            <span className="text-emerald-300 font-semibold">+{r.callingPoints}</span>
          </>
        ) : (
          <>
            Team {callTeam} bid {r.bid} but only had {r.callingPoints}, the other team {r.defenderPoints}:{' '}
            <span className="text-red-400 font-semibold">−{2 * r.bid}</span>
          </>
        )}
      </p>
      <p className="text-xs text-zinc-400">
        Tally: A {r.tally[0]} · B {r.tally[1]}
      </p>
      {r.courtWonBy !== null && (
        <p className="text-sm text-amber-300 font-semibold">
          🏆 Team {teamName(r.courtWonBy)} wins a COURT! Scores reset to 0.
        </p>
      )}
      <p className="text-xs text-zinc-500">Next dealer: {nameOf(game.nextDealer)}</p>
      {isHost ? (
        <button
          onClick={onDeal}
          disabled={busy}
          className="bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 rounded-lg px-6 py-2 transition"
        >
          Deal again
        </button>
      ) : (
        <p className="text-xs text-zinc-500">Waiting for the host to deal again…</p>
      )}
    </div>
  )
}
