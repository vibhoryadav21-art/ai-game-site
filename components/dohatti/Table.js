'use client'

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { getPlayerSecret } from '@/lib/dohattiIdentity'
import { postJson } from '@/lib/dohatti/api'
import { useDohattiText } from '@/lib/dohattiText'
import { BIDS, SUITS, SUIT_SYMBOL, BOT_RISKS, legalPlays, suitOf, rankOf } from '@/lib/dohatti/engine'
import PlayingCard from '@/components/dohatti/PlayingCard'
import BotRisk, { RISK_ICON } from '@/components/dohatti/BotRisk'

// SCREEN LAYOUT (top to bottom), made for a phone:
//   1. symbols: bid, trump card, pile, points of this game
//   2. status on the left, the buttons you need on the right (small)
//   3. the table: partner on top, opponents left and right, YOU at the bottom
//   4. your cards, in two rows
//   5. hints, result, team names and score, bot style
// Everything at the top has a fixed size, so the screen does not jump.
// The seat layout is always left-to-right (dir="ltr"), even in Arabic.

const RANK_LABEL = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' }
const cardText = (card) => `${RANK_LABEL[rankOf(card)] || rankOf(card)}${SUIT_SYMBOL[suitOf(card)]}`
const signed = (n) => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : '0')

// Position inside the trick area. I sit at the BOTTOM, my partner at the TOP.
// Clockwise from me: me (bottom) -> next seat (left) -> partner (top) -> last seat (right).
const TRICK_POS = {
  0: 'col-start-2 row-start-3',
  1: 'col-start-1 row-start-2',
  2: 'col-start-2 row-start-1',
  3: 'col-start-3 row-start-2',
}
// A played card slides in from the side of the player who played it.
const SLIDE_FROM = { 0: 'dh-from-bottom', 1: 'dh-from-left', 2: 'dh-from-top', 3: 'dh-from-right' }

const CARDS_PER_ROW = 7

// Animations never change the size of anything (only transform / opacity / shadow).
const ANIMATION_CSS = `
@keyframes dh-deal { from { opacity: 0; transform: translateY(-14px) scale(.9); } to { opacity: 1; transform: none; } }
@keyframes dh-from-top { from { opacity: 0; transform: translateY(-40px); } to { opacity: 1; transform: none; } }
@keyframes dh-from-right { from { opacity: 0; transform: translateX(40px); } to { opacity: 1; transform: none; } }
@keyframes dh-from-bottom { from { opacity: 0; transform: translateY(40px); } to { opacity: 1; transform: none; } }
@keyframes dh-from-left { from { opacity: 0; transform: translateX(-40px); } to { opacity: 1; transform: none; } }
@keyframes dh-pop { 0% { opacity: 0; transform: scale(.5); } 60% { opacity: 1; transform: scale(1.2); } 100% { transform: scale(1); } }
@keyframes dh-fade-up { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
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

const BTN = 'h-9 min-w-9 px-2.5 rounded-lg text-sm font-semibold transition active:scale-95 disabled:opacity-40'

// A small card with TURUP written on it: marks the caller (the player who chose trump).
function TurupBadge() {
  return (
    <span
      title="TURUP"
      className="inline-flex items-center justify-center w-9 h-[1.15rem] rounded-[3px] border border-zinc-400 bg-white text-[8px] font-extrabold tracking-tight text-red-600 leading-none align-middle"
    >
      TURUP
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

  const risk = BOT_RISKS.includes(room.bot_risk) ? room.bot_risk : 'normal'
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
  const callerCanReveal = playing && iAmCaller && !game.trumpRevealed
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
  const handRows = [sortedHand.slice(0, CARDS_PER_ROW), sortedHand.slice(CARDS_PER_ROW)]

  const tableCards = game.trick.length > 0 ? game.trick : game.lastTrick?.cards || []
  const showingLast = game.trick.length === 0 && !!game.lastTrick && playing
  const lastWinner = showingLast ? game.lastTrick.winner : null

  const bids = game.bidding
  const isFirstBidder = bids.index === 0
  const bidBySeat = Object.fromEntries(bids.history.map((h) => [h.seat, h.bid]))

  // ---- symbols at the top ----
  const bidValue = bidding ? bids.current : game.bid
  const bidSeat = bidding ? bids.bidder : game.caller
  const hasBid = bidValue !== null && bidValue !== undefined
  const bidMine = hasBid && bidSeat % 2 === myTeam
  const bidColor = !hasBid ? 'text-zinc-400' : bidMine ? 'text-sky-300' : 'text-amber-300'

  // ---- status text (short, left of the buttons) ----
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

  // ---- hint under the cards (only when there is something to explain) ----
  let hint = ''
  if (bidding && myTurn) hint = `${bids.current === null ? t.bidChoose : t.bidCurrent(bids.current)} ${t.bidCostDouble}`
  else if (choosing && iAmCaller) hint = t.chooseHint
  else if (canRevealAsVoid) hint = t.voidPrompt(t.suits[ledSuit])
  else if (mustPlayTrump) hint = t.mustPlayTrump

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
  const chipProps = { game, seats, nameOf, myTeam, mySeat, t, lastWinner, risk }

  return (
    <div className="w-full max-w-md flex flex-col items-center gap-2 text-base">
      <style>{ANIMATION_CSS}</style>

      {/* ============ 1. SYMBOLS: bid, trump card, pile, points of this game ============ */}
      <div
        dir="ltr"
        className="w-full h-11 flex items-center justify-around gap-2 bg-zinc-900 border border-zinc-800 rounded-xl px-2"
      >
        <span title={t.symBid} className={`flex items-center gap-1 font-semibold ${bidColor}`}>
          <span>📣</span>
          <span className="text-lg">{hasBid ? bidValue : '–'}</span>
        </span>
        <span title={t.trump} className="flex items-center">
          {game.trumpRevealed ? (
            <span key={game.trumpCard || game.trump} className="inline-flex dh-pop">
              {game.trumpCard ? (
                <PlayingCard card={game.trumpCard} size="xs" />
              ) : (
                <span className="text-xl text-zinc-100">{SUIT_SYMBOL[game.trump]}</span>
              )}
            </span>
          ) : (
            <PlayingCard faceDown size="xs" />
          )}
        </span>
        <span title={t.symPile} className="flex items-center gap-1 font-semibold text-zinc-200">
          <span>📚</span>
          <span className="text-lg">{game.pot}</span>
        </span>
        <span title={t.symPoints} className="flex items-center gap-1 font-semibold">
          <span>⭐</span>
          <span className="text-lg">
            <span className="text-sky-300">{myTally(game.points)}</span>
            <span className="text-zinc-500">–</span>
            <span className="text-amber-300">{game.points[1 - myTeam]}</span>
          </span>
        </span>
      </div>

      {/* ============ 2. STATUS (left) and MY BUTTONS (right, small) ============ */}
      <div dir="ltr" className="w-full h-11 flex items-center justify-between gap-2 px-1">
        <span
          key={status}
          dir="auto"
          className={`dh-fade-up flex-1 min-w-0 truncate text-sm font-semibold ${
            myTurn ? 'text-emerald-300' : 'text-zinc-400'
          }`}
        >
          {status}
        </span>
        <div className="flex items-center gap-1.5 shrink-0">
          {bidding &&
            myTurn &&
            BIDS.map((b) => (
              <button
                key={b}
                disabled={busy || (bids.current !== null && b <= bids.current)}
                onClick={() => action({ type: 'bid', amount: b })}
                className={`${BTN} bg-emerald-800 hover:bg-emerald-700`}
              >
                {b}
              </button>
            ))}
          {bidding && myTurn && !isFirstBidder && (
            <button
              disabled={busy}
              onClick={() => action({ type: 'bid', amount: 'pass' })}
              className={`${BTN} bg-zinc-700 hover:bg-zinc-600`}
            >
              {t.pass}
            </button>
          )}
          {choosing && iAmCaller && (
            <button
              disabled={busy || !selected}
              title={selected ? t.hideAsTrump(cardText(selected)) : t.selectCard}
              aria-label={selected ? t.hideAsTrump(cardText(selected)) : t.selectCard}
              onClick={() => action({ type: 'trump', card: selected })}
              className={`${BTN} bg-emerald-700 hover:bg-emerald-600`}
            >
              ✔ {selected ? cardText(selected) : ''}
            </button>
          )}
          {(callerCanReveal || canRevealAsVoid) && (
            <button
              disabled={busy}
              title={t.revealTrump}
              aria-label={t.revealTrump}
              onClick={() => action({ type: 'reveal' })}
              className={`${BTN} bg-sky-700 hover:bg-sky-600`}
            >
              👁 {t.revealShort}
            </button>
          )}
          {finished && isHost && (
            <button
              disabled={busy}
              onClick={() => act('/api/dohatti/start', {})}
              className={`${BTN} bg-emerald-700 hover:bg-emerald-600`}
            >
              🔄 {t.dealAgain}
            </button>
          )}
        </div>
      </div>

      {/* ============ 3. THE TABLE: partner on top, opponents left / right, me at the bottom ============ */}
      <div dir="ltr" className="w-full flex flex-col items-center gap-1.5">
        <SeatChip seat={seatAt(2)} wide {...chipProps} />
        <div className="w-full flex items-center gap-1.5">
          <SeatChip seat={seatAt(1)} {...chipProps} />
          <div className="relative flex-1 h-36">
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
                      className={`${TRICK_POS[screenPos(seat)]} dh-pop px-2 py-0.5 rounded-lg bg-zinc-800 text-base font-semibold ${
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
              <div className="col-start-2 row-start-2 text-[10px] leading-tight text-zinc-500 text-center">
                {showingLast ? t.lastTrickWon(nameOf(game.lastTrick.winner)) : ''}
                {choosing ? t.choosingShort : ''}
              </div>
            </div>
          </div>
          <SeatChip seat={seatAt(3)} {...chipProps} />
        </div>
        <SeatChip seat={mySeat} wide mine hiddenCard={playing && iAmCaller && !game.trumpRevealed ? hiddenCard : null} {...chipProps} />
      </div>

      {/* ============ 4. MY CARDS, two rows ============ */}
      <div dir="ltr" className="w-full flex flex-col items-center gap-1 min-h-[7.25rem]">
        {handRows.map((row, rowIndex) => (
          <div key={rowIndex} className="flex justify-center gap-1 min-h-14">
            {row.map((card, i) => (
              <div
                key={`${game.gameNo}-${card}`}
                className="dh-deal"
                style={{ animationDelay: `${(rowIndex * CARDS_PER_ROW + i) * 30}ms` }}
              >
                <PlayingCard
                  card={card}
                  selected={choosing && selected === card}
                  onClick={cardHandler(card)}
                  disabled={cardDisabled(card)}
                />
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* ============ 5. below the game ============ */}
      {hint && <p className="text-sm text-zinc-400 text-center">{hint}</p>}
      {error && <p className="text-base text-red-400 text-center">{tr(error)}</p>}

      {finished && (
        <FinishedPanel {...{ game, nameOf, myTeam, myTally, teamLabel, t, isHost }} />
      )}

      {/* Team names and score, just below the game */}
      <div className="w-full text-sm bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2.5 flex flex-col gap-1">
        <div className="flex justify-between items-baseline">
          <span className="text-zinc-300">{t.yourTeamTally}</span>
          <span
            dir="ltr"
            className={`text-xl font-semibold ${
              myTallyNow < 0 ? 'text-red-400' : myTallyNow > 0 ? 'text-emerald-300' : 'text-zinc-200'
            }`}
          >
            {signed(myTallyNow)}
          </span>
        </div>
        <div className="text-zinc-300">{t.courtsLine(myTally(game.courts), game.courts[1 - myTeam])}</div>
        <div className="text-sky-300">{t.yourTeamNames(nameOf(mySeat), nameOf(partnerSeat))}</div>
        <div className="text-amber-300">{t.opponentsNames(nameOf(seatAt(1)), nameOf(seatAt(3)))}</div>
      </div>

      {/* Bot style */}
      <BotRisk room={room} isHost={isHost} t={t} />
    </div>
  )
}

// Same size in every state, so nothing jumps.
function SeatChip({ seat, game, seats, nameOf, myTeam, mySeat, t, lastWinner, risk, wide = false, mine = false, hiddenCard = null }) {
  const row = seats.find((s) => s.seat === seat)
  const sameTeam = seat % 2 === myTeam
  const tag = seat === mySeat ? t.tagYou : sameTeam ? t.tagPartner : t.tagOpponent
  const active = game.phase !== 'finished' && game.turn === seat
  const signal = row?.is_ai ? game.signals?.[seat] : null
  return (
    <div
      className={`relative ${wide ? 'w-40' : 'w-[5.25rem]'} shrink-0 h-12 ${
        sameTeam ? 'border-sky-500/60' : 'border-amber-500/60'
      } ${
        active ? 'ring-2 ring-emerald-400 bg-emerald-950/40 dh-glow' : 'bg-zinc-900'
      } border-2 rounded-xl px-1.5 flex items-center ${hiddenCard ? 'justify-between' : 'justify-center'} text-center`}
    >
      {/* flashes once when this player has just won the trick */}
      {lastWinner === seat && (
        <span
          key={game.trickCount}
          className="dh-flash pointer-events-none absolute inset-0 rounded-xl bg-emerald-400/50"
        />
      )}

      {/* signal of the bot's last move: green = fine or automatic, red = the AI model failed */}
      {signal && (
        <span
          key={`${seat}-${signal}-${game.version}`}
          title={signal === 'g' ? t.sigOk : t.sigError}
          className={`dh-pop absolute top-1 right-1 w-2.5 h-2.5 rounded-full ${
            signal === 'g' ? 'bg-emerald-400' : 'bg-red-500'
          }`}
        />
      )}

      <div className="flex flex-col items-center leading-tight min-w-0">
        <span className="text-sm w-full truncate">
          {row?.is_ai ? '🤖 ' : ''}
          {nameOf(seat)}
        </span>
        <span className="flex items-center justify-center gap-1 text-[11px] font-semibold leading-tight">
          <span className={sameTeam ? 'text-sky-300' : 'text-amber-300'}>{tag}</span>
          {row?.is_ai && <span title={risk}>{RISK_ICON[risk]}</span>}
          {game.dealer === seat && <span>🃏</span>}
          {game.caller === seat && <TurupBadge />}
        </span>
      </div>

      {/* the caller's hidden trump card: visible to the caller only, not playable */}
      {hiddenCard && <PlayingCard card={hiddenCard} size="xs" dim />}
    </div>
  )
}

function FinishedPanel({ game, nameOf, myTeam, myTally, teamLabel, t, isHost }) {
  const r = game.result
  const callLabel = teamLabel(r.callingTeam)
  const myDelta = myTally(r.delta)
  const myTallyAfter = myTally(r.tally)
  return (
    <div className="dh-fade-up w-full flex flex-col items-center gap-1.5 bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-center">
      <p className="text-sm">
        {r.made
          ? t.madeLine(callLabel, r.bid, r.callingPoints)
          : t.missedLine(callLabel, r.bid, r.callingPoints, r.defenderPoints)}
      </p>
      <p className={`text-lg font-semibold ${myDelta < 0 ? 'text-red-400' : 'text-emerald-300'}`}>
        {t.deltaLine(signed(myDelta), signed(myTallyAfter))}
      </p>
      {r.courtWonBy !== null && (
        <p className="dh-pop text-sm text-amber-300 font-semibold">
          {r.courtWonBy === myTeam ? t.courtYou : t.courtThem}
        </p>
      )}
      <p className="text-xs text-zinc-500">{t.nextDealer(nameOf(game.nextDealer))}</p>
      {!isHost && <p className="text-xs text-zinc-500">{t.waitingDeal}</p>}
    </div>
  )
}
