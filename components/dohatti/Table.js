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
  legalPlays,
  suitOf,
  rankOf,
} from '@/lib/dohatti/engine'
import PlayingCard from '@/components/dohatti/PlayingCard'

const RANK_LABEL = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' }
const cardText = (card) => `${RANK_LABEL[rankOf(card)] || rankOf(card)}${SUIT_SYMBOL[suitOf(card)]}`
const signed = (n) => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : '0')

const SOURCE_LABEL = {
  llm: 'AI model',
  rules: 'rule bot',
  'rules-fallback': 'rule bot (AI model failed)',
}

// Position inside the trick area. I sit at the TOP, my partner at the BOTTOM.
// Order clockwise from me: me (top) -> next seat (right) -> partner (bottom) -> last seat (left).
const TRICK_POS = {
  0: 'col-start-2 row-start-1',
  1: 'col-start-3 row-start-2',
  2: 'col-start-2 row-start-3',
  3: 'col-start-1 row-start-2',
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
  const partnerSeat = (mySeat + 2) % 4
  const nameOf = (seat) => seats.find((s) => s.seat === seat)?.display_name || `Seat ${seat + 1}`
  const screenPos = (seat) => (seat - mySeat + 4) % 4
  const seatAt = (pos) => (mySeat + pos) % 4
  const myTally = (pair) => (myTeam === 0 ? pair[0] : pair[1])
  const teamLabel = (team) => (team === myTeam ? 'Your team' : 'Opponents')

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
    return <p className="text-zinc-400 text-base">Dealing the cards…</p>
  }

  const { phase } = game
  const bidding = phase === 'bidding'
  const choosing = phase === 'choosing_trump'
  const playing = phase === 'playing'
  const finished = phase === 'finished'
  const myTurn = !finished && game.turn === mySeat
  const iAmCaller = game.caller === mySeat
  const legal = playing && myTurn ? legalPlays(game, hand, mySeat) : []

  // Out of the suit that was led, trump still hidden, and I am not the caller: I may reveal.
  const ledSuit = game.trick.length > 0 ? suitOf(game.trick[0].card) : null
  const iAmVoid = !!ledSuit && !hand.some((c) => suitOf(c) === ledSuit)
  const canRevealAsVoid = playing && myTurn && !iAmCaller && !game.trumpRevealed && iAmVoid

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
    status = `${teamLabel(game.result.callingTeam)} ${game.result.made ? 'made' : 'missed'} the bid`
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

  const myTallyNow = myTally(game.scores)

  return (
    <div className="w-full max-w-md flex flex-col items-center gap-3 text-base">
      {/* Info strip */}
      <div className="w-full text-sm bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2.5 flex flex-col gap-1.5">
        <div className="flex justify-between text-zinc-400">
          <span>
            ⏱ {formatDuration(matchSeconds)} · Game {game.gameNo} ({formatDuration(gameSeconds)})
          </span>
          <span>
            Courts: {myTally(game.courts)} – {game.courts[1 - myTeam]}
          </span>
        </div>
        <div className="flex justify-between items-baseline">
          <span className="text-zinc-300">Your team</span>
          <span className={`text-xl font-semibold ${myTallyNow < 0 ? 'text-red-400' : myTallyNow > 0 ? 'text-emerald-300' : 'text-zinc-200'}`}>
            {signed(myTallyNow)}
          </span>
        </div>
        <div className="text-sky-300">
          Your team: {nameOf(mySeat)} + {nameOf(partnerSeat)}
        </div>
        <div className="text-amber-300">
          Opponents: {nameOf(seatAt(1))} + {nameOf(seatAt(3))}
        </div>
        {game.bid && (
          <div className="flex flex-wrap justify-between gap-x-3 text-zinc-300">
            <span>
              Bid: {teamLabel(game.callingTeam)} {game.bid}
            </span>
            <span>
              Points {myTally(game.points)}–{game.points[1 - myTeam]} · Pile {game.pot}
            </span>
          </div>
        )}
        {game.bid && (
          <div className="text-zinc-300">
            Trump:{' '}
            {game.trumpRevealed ? (
              <span className="font-semibold">
                {SUIT_SYMBOL[game.trump]} {SUIT_NAME[game.trump]}{' '}
                <span className="text-zinc-500 font-normal">(revealed by {nameOf(game.revealedBy)})</span>
              </span>
            ) : hiddenCard ? (
              <span className="font-semibold">{SUIT_SYMBOL[suitOf(hiddenCard)]} hidden (only you know)</span>
            ) : (
              'hidden'
            )}
          </div>
        )}
      </div>

      {/* Status */}
      <p className={`text-xl font-semibold text-center ${myTurn ? 'text-emerald-300' : 'text-zinc-300'}`}>{status}</p>
      {game.aiNote && !finished && (
        <p className="text-sm text-zinc-500 text-center -mt-1">
          🤖 {nameOf(game.aiNote.seat)}{' '}
          {game.aiNote.kind === 'bid'
            ? game.aiNote.bid === 'pass'
              ? 'passed'
              : `bid ${game.aiNote.bid}`
            : game.aiNote.kind === 'trump'
              ? 'hid the trump card'
              : `${game.aiNote.revealed ? 'revealed trump and ' : ''}played ${cardText(game.aiNote.card)}`}{' '}
          · {SOURCE_LABEL[game.aiNote.source] || game.aiNote.source}
          {game.aiNote.text ? ` · “${game.aiNote.text}”` : ''}
        </p>
      )}
      {error && <p className="text-base text-red-400 text-center">{error}</p>}

      {/* ME + MY CARDS, at the top */}
      <div
        className={`w-full rounded-xl border-2 px-2 py-2.5 flex flex-col items-center gap-2.5 border-sky-500/60 ${
          myTurn ? 'ring-2 ring-emerald-400 bg-emerald-950/30' : 'bg-zinc-900'
        }`}
      >
        <div className="w-full flex items-center justify-between text-sm px-1">
          <span>
            {nameOf(mySeat)} <span className="text-emerald-300">(you)</span>
            {game.dealer === mySeat ? ' · 🃏 dealer' : ''}
            {iAmCaller ? ' · 🎯 caller' : ''}
          </span>
          <span className="text-zinc-500">{game.handSizes[mySeat]} cards</span>
        </div>
        <div className="flex flex-wrap justify-center gap-1.5">
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

        {/* The caller's hidden trump card: visible, but separate from the hand and not playable */}
        {playing && iAmCaller && !game.trumpRevealed && hiddenCard && (
          <div className="w-full flex items-center justify-center gap-3 border-t border-zinc-800 pt-2.5">
            <PlayingCard card={hiddenCard} size="sm" dim />
            <div className="flex flex-col gap-1.5">
              <span className="text-sm text-zinc-400">Hidden trump card. You cannot play it until you reveal.</span>
              <button
                disabled={busy}
                onClick={() => action({ type: 'reveal' })}
                className="bg-sky-700 hover:bg-sky-600 disabled:opacity-50 rounded-lg px-4 py-2 text-base transition"
              >
                Reveal trump
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Actions */}
      {bidding && (
        <div className="w-full flex flex-col items-center gap-2.5">
          {bids.history.length > 0 && (
            <p className="text-sm text-zinc-400 text-center">
              {bids.history.map((h) => `${nameOf(h.seat)}: ${h.bid}`).join(' · ')}
            </p>
          )}
          {myTurn && (
            <>
              <p className="text-sm text-zinc-400 text-center">
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
                    className="w-20 h-14 text-2xl rounded-xl bg-emerald-800 hover:bg-emerald-700 disabled:opacity-30 transition"
                  >
                    {b}
                  </button>
                ))}
                {!isFirstBidder && (
                  <button
                    disabled={busy}
                    onClick={() => action({ type: 'bid', amount: 'pass' })}
                    className="px-5 h-14 text-lg rounded-xl bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 transition"
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
        <div className="flex flex-col items-center gap-2.5">
          <p className="text-sm text-zinc-400 text-center">
            Tap one of your cards. It is set aside face down and its suit becomes trump. You cannot play it
            until you reveal trump.
          </p>
          <button
            disabled={busy || !selected}
            onClick={() => action({ type: 'trump', card: selected })}
            className="bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 rounded-xl px-6 py-3 text-lg transition"
          >
            {selected ? `Hide ${cardText(selected)} as trump` : 'Select a card'}
          </button>
        </div>
      )}

      {canRevealAsVoid && (
        <div className="w-full flex flex-col items-center gap-2 bg-zinc-900 border border-sky-700/50 rounded-xl px-3 py-3 text-center">
          <p className="text-sm text-zinc-300">
            You have no {SUIT_NAME[ledSuit]}. Play any card to discard it, or reveal trump (then you must
            play a trump card if you have one).
          </p>
          <button
            disabled={busy}
            onClick={() => action({ type: 'reveal' })}
            className="bg-sky-700 hover:bg-sky-600 disabled:opacity-50 rounded-lg px-5 py-2.5 text-base transition"
          >
            Reveal trump
          </button>
        </div>
      )}

      {playing && myTurn && game.revealedBy === mySeat && game.revealedAtTrick === game.trickCount + 1 && legal.length > 0 && legal.every((c) => suitOf(c) === game.trump) && iAmVoid && (
        <p className="text-sm text-sky-300 text-center">You revealed trump, so you must play a trump card.</p>
      )}

      {finished && (
        <FinishedPanel
          game={game}
          nameOf={nameOf}
          myTeam={myTeam}
          myTally={myTally}
          teamLabel={teamLabel}
          isHost={isHost}
          busy={busy}
          onDeal={() => act('/api/dohatti/start', {})}
        />
      )}

      {/* Table: the cards in play. I sit at the top, my partner at the bottom. */}
      {!bidding && !choosing && (
        <div className="w-full flex flex-col items-center gap-2">
          <div className="w-full flex items-stretch gap-1.5">
            <SeatChip seat={seatAt(3)} game={game} seats={seats} nameOf={nameOf} myTeam={myTeam} mySeat={mySeat} />
            <div className="relative flex-1 min-h-48">
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
            <SeatChip seat={seatAt(1)} game={game} seats={seats} nameOf={nameOf} myTeam={myTeam} mySeat={mySeat} />
          </div>
          <SeatChip seat={partnerSeat} game={game} seats={seats} nameOf={nameOf} myTeam={myTeam} mySeat={mySeat} wide />
          {showingLast && (
            <p className="text-sm text-zinc-500">Last trick won by {nameOf(game.lastTrick.winner)}</p>
          )}
        </div>
      )}

      {(bidding || choosing) && (
        <div className="w-full flex justify-center gap-2 flex-wrap">
          {[3, 2, 1].map((pos) => (
            <SeatChip key={pos} seat={seatAt(pos)} game={game} seats={seats} nameOf={nameOf} myTeam={myTeam} mySeat={mySeat} wide />
          ))}
        </div>
      )}
    </div>
  )
}

function SeatChip({ seat, game, seats, nameOf, myTeam, mySeat, wide = false }) {
  const row = seats.find((s) => s.seat === seat)
  const mine = seat % 2 === myTeam
  const tag = seat === mySeat ? 'You' : mine ? 'Partner' : 'Opponent'
  const active = game.phase !== 'finished' && game.turn === seat
  return (
    <div
      className={`${wide ? 'w-32' : 'w-24'} ${
        mine ? 'border-sky-500/60' : 'border-amber-500/60'
      } ${active ? 'ring-2 ring-emerald-400 bg-emerald-950/40' : 'bg-zinc-900'} border-2 rounded-xl px-1.5 py-2 flex flex-col items-center justify-center text-center`}
    >
      <span className="text-base leading-tight w-full truncate">
        {row?.is_ai ? '🤖 ' : ''}
        {nameOf(seat)}
      </span>
      <span className={`text-xs font-semibold leading-tight ${mine ? 'text-sky-300' : 'text-amber-300'}`}>{tag}</span>
      <span className="text-xs text-zinc-500 leading-tight">
        {game.handSizes[seat]} cards
        {game.dealer === seat ? ' · 🃏' : ''}
        {game.caller === seat ? ' · 🎯' : ''}
      </span>
    </div>
  )
}

function FinishedPanel({ game, nameOf, myTeam, myTally, teamLabel, isHost, busy, onDeal }) {
  const r = game.result
  const callLabel = teamLabel(r.callingTeam)
  const myDelta = myTally(r.delta)
  const myTallyAfter = myTally(r.tally)
  return (
    <div className="w-full flex flex-col items-center gap-2 bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3.5 text-center">
      <p className="text-base">
        {r.made ? (
          <>
            {callLabel} bid {r.bid} and collected {r.callingPoints}.
          </>
        ) : (
          <>
            {callLabel} bid {r.bid} but only collected {r.callingPoints} (the other side {r.defenderPoints}).
          </>
        )}
      </p>
      <p className={`text-xl font-semibold ${myDelta < 0 ? 'text-red-400' : 'text-emerald-300'}`}>
        Your team {signed(myDelta)} → {signed(myTallyAfter)}
      </p>
      {r.courtWonBy !== null && (
        <p className="text-base text-amber-300 font-semibold">
          🏆 {r.courtWonBy === myTeam ? 'Your team wins' : 'The opponents win'} a COURT! Tally resets to 0.
        </p>
      )}
      <p className="text-sm text-zinc-500">Next dealer: {nameOf(game.nextDealer)}</p>
      {isHost ? (
        <button
          onClick={onDeal}
          disabled={busy}
          className="bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 rounded-xl px-8 py-3 text-lg transition"
        >
          Deal again
        </button>
      ) : (
        <p className="text-sm text-zinc-500">Waiting for the host to deal again…</p>
      )}
    </div>
  )
}
