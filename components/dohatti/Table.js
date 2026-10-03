'use client'

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { getPlayerSecret } from '@/lib/dohattiIdentity'
import { postJson } from '@/lib/dohatti/api'
import { useDohattiText } from '@/lib/dohattiText'
import { BIDS, SUITS, SUIT_SYMBOL, legalPlays, suitOf, rankOf } from '@/lib/dohatti/engine'
import PlayingCard from '@/components/dohatti/PlayingCard'

// LAYOUT RULE: everything at the top has a FIXED size, so the screen never jumps.
// Everything that changes (status, bot notes, buttons, scores, timers) is at the bottom.
// The seat layout is always left-to-right (dir="ltr"), even in Arabic, so that the
// clockwise order of the seats stays the same.

const RANK_LABEL = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' }
const cardText = (card) => `${RANK_LABEL[rankOf(card)] || rankOf(card)}${SUIT_SYMBOL[suitOf(card)]}`
const signed = (n) => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : '0')

// Position inside the trick area. I sit at the TOP, my partner at the BOTTOM.
// Clockwise from me: me (top) -> next seat (right) -> partner (bottom) -> last seat (left).
const TRICK_POS = {
  0: 'col-start-2 row-start-1',
  1: 'col-start-3 row-start-2',
  2: 'col-start-2 row-start-3',
  3: 'col-start-1 row-start-2',
}
// A played card slides in from the side of the player who played it.
const SLIDE_FROM = { 0: 'dh-from-top', 1: 'dh-from-right', 2: 'dh-from-bottom', 3: 'dh-from-left' }

// Animations never change the size of anything (only transform / opacity / shadow).
const ANIMATION_CSS = `
@keyframes dh-deal { from { opacity: 0; transform: translateY(-14px) scale(.9); } to { opacity: 1; transform: none; } }
@keyframes dh-from-top { from { opacity: 0; transform: translateY(-40px); } to { opacity: 1; transform: none; } }
@keyframes dh-from-right { from { opacity: 0; transform: translateX(40px); } to { opacity: 1; transform: none; } }
@keyframes dh-from-bottom { from { opacity: 0; transform: translateY(40px); } to { opacity: 1; transform: none; } }
@keyframes dh-from-left { from { opacity: 0; transform: translateX(-40px); } to { opacity: 1; transform: none; } }
@keyframes dh-pop { 0% { opacity: 0; transform: scale(.5); } 60% { opacity: 1; transform: scale(1.2); } 100% { transform: scale(1); } }
@keyframes dh-fade-up { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
@keyframes dh-flash { 0% { opacity: .85; } 100% { opacity: 0; } }
@keyframes dh-glow { 0%, 100% { box-shadow: 0 0 0 0 rgba(52, 211, 153, 0); } 50% { box-shadow: 0 0 16px 3px rgba(52, 211, 153, .55); } }
.dh-deal { animation: dh-deal .35s ease-out both; }
.dh-from-top { animation: dh-from-top .3s ease-out both; }
.dh-from-right { animation: dh-from-right .3s ease-out both; }
.dh-from-bottom { animation: dh-from-bottom .3s ease-out both; }
.dh-from-left { animation: dh-from-left .3s ease-out both; }
.dh-pop { animation: dh-pop .45s ease-out both; }
.dh-fade-up { animation: dh-fade-up .3s ease-out both; }
.dh-flash { animation: dh-flash 1.1s ease-out both; }
.dh-glow { animation: dh-glow 1.8s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) { [class*="dh-"] { animation: none !important; } }
`

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

// A card written as text, red for hearts and diamonds.
function CardInline({ card }) {
  const red = suitOf(card) === 'H' || suitOf(card) === 'D'
  return (
    <span dir="ltr" className={red ? 'text-red-400' : 'text-zinc-100'}>
      {cardText(card)}
    </span>
  )
}

export default function Table({ room, seats, me, isHost }) {
  const { t, tr } = useDohattiText()
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
  const nameOf = (seat) => seats.find((s) => s.seat === seat)?.display_name || `${seat + 1}`
  const screenPos = (seat) => (seat - mySeat + 4) % 4
  const seatAt = (pos) => (mySeat + pos) % 4
  const myTally = (pair) => (myTeam === 0 ? pair[0] : pair[1])
  const teamLabel = (team) => (team === myTeam ? t.labelYourTeam : t.labelOpponents)

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
    return <p className="text-zinc-400 text-base">{t.dealing}</p>
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
  const mustPlayTrump =
    playing &&
    myTurn &&
    game.trumpRevealed &&
    game.revealedBy === mySeat &&
    game.revealedAtTrick === game.trickCount + 1 &&
    iAmVoid &&
    legal.length > 0 &&
    legal.every((c) => suitOf(c) === game.trump)

  const sortedHand = [...hand].sort(
    (a, b) => SUITS.indexOf(suitOf(a)) - SUITS.indexOf(suitOf(b)) || rankOf(b) - rankOf(a)
  )

  const matchSeconds = Math.floor((now - game.matchStartedAt) / 1000)
  const gameSeconds = Math.floor(((finished ? game.finishedAt : now) - game.gameStartedAt) / 1000)

  const tableCards = game.trick.length > 0 ? game.trick : game.lastTrick?.cards || []
  const showingLast = game.trick.length === 0 && !!game.lastTrick && playing
  const lastWinner = showingLast ? game.lastTrick.winner : null

  const bids = game.bidding
  const isFirstBidder = bids.index === 0
  const bidBySeat = Object.fromEntries(bids.history.map((h) => [h.seat, h.bid]))

  // ---- TOP: bid value and who made it ----
  const bidValue = bidding ? bids.current : game.bid
  const bidSeat = bidding ? bids.bidder : game.caller
  const hasBid = bidValue !== null && bidValue !== undefined
  const bidMine = hasBid && bidSeat % 2 === myTeam
  const bidText = hasBid ? t.bidLine(bidValue, nameOf(bidSeat), bidMine) : t.bidNone
  const bidColor = !hasBid ? 'text-zinc-400' : bidMine ? 'text-sky-300' : 'text-amber-300'

  // ---- BOTTOM: status line ----
  let status
  if (finished) {
    const label = teamLabel(game.result.callingTeam)
    status = game.result.made ? t.statusMade(label) : t.statusMissed(label)
  } else if (bidding) {
    status = myTurn ? t.statusYourBid : t.statusWaitBid(nameOf(game.turn))
  } else if (choosing) {
    status = iAmCaller ? t.statusPickHidden : t.statusChoosing(nameOf(game.caller))
  } else {
    status = myTurn ? t.statusYourTurn : t.statusWaiting(nameOf(game.turn))
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
  const note = game.aiNote && !finished ? game.aiNote : null
  const srcLabels = { llm: t.srcLlm, rules: t.srcRules, 'rules-fallback': t.srcFallback }

  return (
    <div className="w-full max-w-md flex flex-col items-center gap-3 text-base">
      <style>{ANIMATION_CSS}</style>

      {/* ===================== TOP (fixed size) ===================== */}

      {/* Bid and trump. The right side is left free for the leave icon. */}
      <div className="w-full h-16 pr-14 flex flex-col justify-center">
        <div className={`truncate text-lg font-semibold ${bidColor}`}>{bidText}</div>
        <div className="truncate text-lg font-semibold">
          <span className="text-zinc-400">{t.trump}: </span>
          {game.trumpRevealed ? (
            <>
              <span key={game.trumpCard || game.trump} className="inline-block dh-pop">
                {game.trumpCard ? <CardInline card={game.trumpCard} /> : <span>{SUIT_SYMBOL[game.trump]}</span>}
              </span>{' '}
              <span className="text-sm font-normal text-zinc-500">
                {t.revealedInfo(t.suits[game.trump], nameOf(game.revealedBy))}
              </span>
            </>
          ) : (
            <span className="text-zinc-300">{t.hidden}</span>
          )}
        </div>
      </div>

      {/* Me and my cards */}
      <div
        className={`w-full rounded-xl border-2 px-2 py-2 border-sky-500/60 ${
          myTurn ? 'ring-2 ring-emerald-400 bg-emerald-950/30 dh-glow' : 'bg-zinc-900'
        }`}
      >
        <div className="h-14 flex items-center justify-between px-1 gap-2">
          <div className="flex flex-col leading-tight min-w-0">
            <span className="text-base truncate">
              {nameOf(mySeat)} <span className="text-emerald-300">{t.you}</span>
            </span>
            <span className="text-sm text-zinc-500 truncate">
              {t.cardsCount(game.handSizes[mySeat])}
              {game.dealer === mySeat ? ` · ${t.dealerTag}` : ''}
              {iAmCaller ? ` · ${t.callerTag}` : ''}
            </span>
          </div>
          {/* The caller's hidden trump card: visible, separate from the hand, not playable */}
          {playing && iAmCaller && !game.trumpRevealed && hiddenCard && (
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-xs text-zinc-400 text-center leading-tight">
                {t.hiddenTrumpA}
                <br />
                {t.hiddenTrumpB}
              </span>
              <PlayingCard card={hiddenCard} size="sm" dim />
            </div>
          )}
        </div>
        <div dir="ltr" className="flex flex-wrap justify-center content-start gap-1.5 min-h-[9.5rem]">
          {sortedHand.map((card, i) => (
            <div key={`${game.gameNo}-${card}`} className="dh-deal" style={{ animationDelay: `${i * 30}ms` }}>
              <PlayingCard
                card={card}
                selected={choosing && selected === card}
                onClick={cardHandler(card)}
                disabled={cardDisabled(card)}
              />
            </div>
          ))}
        </div>
      </div>

      {/* The table. Same size in every phase. */}
      <div dir="ltr" className="w-full flex flex-col items-center gap-2">
        <div className="w-full flex items-center gap-1.5">
          <SeatChip seat={seatAt(3)} {...{ game, seats, nameOf, myTeam, mySeat, t, lastWinner }} />
          <div className="relative flex-1 h-48">
            {/* cards in play (faded when it is the previous trick) */}
            <div
              className={`absolute inset-0 grid grid-cols-3 grid-rows-3 place-items-center ${
                showingLast ? 'opacity-50' : ''
              }`}
            >
              {!bidding &&
                tableCards.map((play) => (
                  <div
                    key={`${play.seat}-${play.card}`}
                    className={`${TRICK_POS[screenPos(play.seat)]} ${SLIDE_FROM[screenPos(play.seat)]}`}
                  >
                    <PlayingCard card={play.card} size="sm" />
                  </div>
                ))}
            </div>
            {/* bids, shown where each player sits */}
            {bidding && (
              <div className="absolute inset-0 grid grid-cols-3 grid-rows-3 place-items-center">
                {[0, 1, 2, 3].map((seat) =>
                  bidBySeat[seat] !== undefined ? (
                    <span
                      key={`${seat}-${bidBySeat[seat]}`}
                      className={`${TRICK_POS[screenPos(seat)]} dh-pop px-2.5 py-1 rounded-lg bg-zinc-800 text-lg font-semibold ${
                        bidBySeat[seat] === 'pass' ? 'text-zinc-400' : 'text-emerald-300'
                      }`}
                    >
                      {bidBySeat[seat] === 'pass' ? t.pass : bidBySeat[seat]}
                    </span>
                  ) : null
                )}
              </div>
            )}
            {/* small text in the empty middle */}
            <div className="absolute inset-0 grid grid-cols-3 grid-rows-3 place-items-center pointer-events-none">
              <div className="col-start-2 row-start-2 text-[11px] leading-tight text-zinc-500 text-center">
                {showingLast ? t.lastTrickWon(nameOf(game.lastTrick.winner)) : ''}
                {choosing ? t.choosingShort : ''}
              </div>
            </div>
          </div>
          <SeatChip seat={seatAt(1)} {...{ game, seats, nameOf, myTeam, mySeat, t, lastWinner }} />
        </div>
        <SeatChip seat={partnerSeat} wide {...{ game, seats, nameOf, myTeam, mySeat, t, lastWinner }} />
      </div>

      {/* ===================== BOTTOM (everything that moves) ===================== */}
      <div className="w-full flex flex-col items-center gap-3 border-t border-zinc-800 pt-3">
        {/* Status and what the last bot did */}
        <p
          key={status}
          className={`dh-fade-up min-h-[3rem] flex items-center justify-center text-xl font-semibold text-center ${
            myTurn ? 'text-emerald-300' : 'text-zinc-300'
          }`}
        >
          {status}
        </p>
        <p className="min-h-[2.75rem] text-sm text-zinc-500 text-center">
          {note && (
            <>
              🤖 {nameOf(note.seat)}{' '}
              {note.kind === 'bid'
                ? note.bid === 'pass'
                  ? t.botPassed
                  : t.botBid(note.bid)
                : note.kind === 'trump'
                  ? t.botHidTrump
                  : note.revealed
                    ? t.botRevealedPlayed(cardText(note.card))
                    : t.botPlayed(cardText(note.card))}{' '}
              · {srcLabels[note.source] || note.source}
              {note.text ? ` · “${note.text}”` : ''}
            </>
          )}
        </p>
        {error && <p className="text-base text-red-400 text-center">{tr(error)}</p>}

        {/* Bidding buttons */}
        {bidding && myTurn && (
          <div className="w-full flex flex-col items-center gap-2.5">
            <p className="text-sm text-zinc-400 text-center">
              {bids.current === null ? t.bidChoose : t.bidCurrent(bids.current)} {t.bidCostDouble}
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {BIDS.map((b) => (
                <button
                  key={b}
                  disabled={busy || (bids.current !== null && b <= bids.current)}
                  onClick={() => action({ type: 'bid', amount: b })}
                  className="w-20 h-14 text-2xl rounded-xl bg-emerald-800 hover:bg-emerald-700 disabled:opacity-30 transition active:scale-95"
                >
                  {b}
                </button>
              ))}
              {!isFirstBidder && (
                <button
                  disabled={busy}
                  onClick={() => action({ type: 'bid', amount: 'pass' })}
                  className="px-5 h-14 text-lg rounded-xl bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 transition active:scale-95"
                >
                  {t.pass}
                </button>
              )}
            </div>
          </div>
        )}

        {/* Choose the hidden trump card */}
        {choosing && iAmCaller && (
          <div className="flex flex-col items-center gap-2.5">
            <p className="text-sm text-zinc-400 text-center">{t.chooseHint}</p>
            <button
              disabled={busy || !selected}
              onClick={() => action({ type: 'trump', card: selected })}
              className="bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 rounded-xl px-6 py-3 text-lg transition active:scale-95"
            >
              {selected ? t.hideAsTrump(cardText(selected)) : t.selectCard}
            </button>
          </div>
        )}

        {/* Caller: reveal */}
        {playing && iAmCaller && !game.trumpRevealed && (
          <button
            disabled={busy}
            onClick={() => action({ type: 'reveal' })}
            className="w-full bg-sky-700 hover:bg-sky-600 disabled:opacity-50 rounded-xl px-5 py-3 text-lg transition active:scale-95"
          >
            {t.revealTrump}
          </button>
        )}

        {/* Other player who has no card of the led suit: reveal or discard */}
        {canRevealAsVoid && (
          <div className="dh-fade-up w-full flex flex-col items-center gap-2 bg-zinc-900 border border-sky-700/50 rounded-xl px-3 py-3 text-center">
            <p className="text-sm text-zinc-300">{t.voidPrompt(t.suits[ledSuit])}</p>
            <button
              disabled={busy}
              onClick={() => action({ type: 'reveal' })}
              className="bg-sky-700 hover:bg-sky-600 disabled:opacity-50 rounded-lg px-5 py-2.5 text-base transition active:scale-95"
            >
              {t.revealTrump}
            </button>
          </div>
        )}

        {mustPlayTrump && <p className="text-sm text-sky-300 text-center">{t.mustPlayTrump}</p>}

        {finished && (
          <FinishedPanel
            {...{ game, nameOf, myTeam, myTally, teamLabel, t, busy }}
            isHost={isHost}
            onDeal={() => act('/api/dohatti/start', {})}
          />
        )}

        {/* Scores, teams and timers */}
        <div className="w-full text-sm bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-3 flex flex-col gap-1.5">
          <div className="flex justify-between items-baseline">
            <span className="text-zinc-300 text-base">{t.yourTeamTally}</span>
            <span
              dir="ltr"
              className={`text-2xl font-semibold ${
                myTallyNow < 0 ? 'text-red-400' : myTallyNow > 0 ? 'text-emerald-300' : 'text-zinc-200'
              }`}
            >
              {signed(myTallyNow)}
            </span>
          </div>
          <div className="flex justify-between gap-2 text-zinc-300">
            <span>{t.courtsLine(myTally(game.courts), game.courts[1 - myTeam])}</span>
            {game.bid && <span>{t.pointsLine(myTally(game.points), game.points[1 - myTeam], game.pot)}</span>}
          </div>
          <div className="text-sky-300">{t.yourTeamNames(nameOf(mySeat), nameOf(partnerSeat))}</div>
          <div className="text-amber-300">{t.opponentsNames(nameOf(seatAt(1)), nameOf(seatAt(3)))}</div>
          <div className="text-zinc-400">
            {t.timeLine(formatDuration(matchSeconds), formatDuration(gameSeconds), game.gameNo)}
          </div>
        </div>
      </div>
    </div>
  )
}

// Same height in every state, so nothing jumps.
function SeatChip({ seat, game, seats, nameOf, myTeam, mySeat, t, lastWinner, wide = false }) {
  const row = seats.find((s) => s.seat === seat)
  const mine = seat % 2 === myTeam
  const tag = seat === mySeat ? t.tagYou : mine ? t.tagPartner : t.tagOpponent
  const active = game.phase !== 'finished' && game.turn === seat
  return (
    <div
      className={`relative ${wide ? 'w-36' : 'w-24'} shrink-0 h-[4.75rem] ${
        mine ? 'border-sky-500/60' : 'border-amber-500/60'
      } ${
        active ? 'ring-2 ring-emerald-400 bg-emerald-950/40 dh-glow' : 'bg-zinc-900'
      } border-2 rounded-xl px-1.5 flex flex-col items-center justify-center text-center`}
    >
      {/* flashes once when this player has just won the trick */}
      {lastWinner === seat && (
        <span
          key={game.trickCount}
          className="dh-flash pointer-events-none absolute inset-0 rounded-xl bg-emerald-400/50"
        />
      )}
      <span className="text-base leading-tight w-full truncate">
        {row?.is_ai ? '🤖 ' : ''}
        {nameOf(seat)}
      </span>
      <span className={`text-xs font-semibold leading-tight ${mine ? 'text-sky-300' : 'text-amber-300'}`}>
        {tag}
        {game.dealer === seat ? ' 🃏' : ''}
        {game.caller === seat ? ' 🎯' : ''}
      </span>
      <span className="text-xs text-zinc-500 leading-tight">{t.cardsCount(game.handSizes[seat])}</span>
    </div>
  )
}

function FinishedPanel({ game, nameOf, myTeam, myTally, teamLabel, t, busy, isHost, onDeal }) {
  const r = game.result
  const callLabel = teamLabel(r.callingTeam)
  const myDelta = myTally(r.delta)
  const myTallyAfter = myTally(r.tally)
  return (
    <div className="dh-fade-up w-full flex flex-col items-center gap-2 bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3.5 text-center">
      <p className="text-base">
        {r.made
          ? t.madeLine(callLabel, r.bid, r.callingPoints)
          : t.missedLine(callLabel, r.bid, r.callingPoints, r.defenderPoints)}
      </p>
      <p className={`text-xl font-semibold ${myDelta < 0 ? 'text-red-400' : 'text-emerald-300'}`}>
        {t.deltaLine(signed(myDelta), signed(myTallyAfter))}
      </p>
      {r.courtWonBy !== null && (
        <p className="dh-pop text-base text-amber-300 font-semibold">
          {r.courtWonBy === myTeam ? t.courtYou : t.courtThem}
        </p>
      )}
      <p className="text-sm text-zinc-500">{t.nextDealer(nameOf(game.nextDealer))}</p>
      {isHost ? (
        <button
          onClick={onDeal}
          disabled={busy}
          className="bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 rounded-xl px-8 py-3 text-lg transition active:scale-95"
        >
          {t.dealAgain}
        </button>
      ) : (
        <p className="text-sm text-zinc-500">{t.waitingDeal}</p>
      )}
    </div>
  )
}
