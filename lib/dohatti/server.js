// SERVER-ONLY helpers. Never import this file from a browser component.
// It uses the Supabase SERVICE ROLE key, which can read and write everything.

import { createClient } from '@supabase/supabase-js'
import { createHash } from 'crypto'
import * as engine from '@/lib/dohatti/engine'
import * as agent from '@/lib/dohatti/agent'
import { buildAiLogRow } from '@/lib/dohatti/aiLog'

const AI_DELAY_MS = 800 // pause before each bot move so humans can follow the game

export function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Server is missing SUPABASE_SERVICE_ROLE_KEY.')
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

export function hashSecret(secret) {
  return createHash('sha256').update(String(secret)).digest('hex')
}

// The browser keeps a private secret. The seat's player_id is the SHA-256 hash of it.
// Only someone who knows the secret can prove they own the seat.
export async function findSeat(db, roomId, secret) {
  if (!roomId || !secret) return null
  const { data, error } = await db
    .from('dohatti_players')
    .select('*')
    .eq('room_id', roomId)
    .eq('player_id', hashSecret(secret))
    .maybeSingle()
  if (error) throw error
  return data
}

export async function loadEngine(db, roomId) {
  const { data, error } = await db
    .from('dohatti_engine')
    .select('*')
    .eq('room_id', roomId)
    .maybeSingle()
  if (error) throw error
  return data
}

async function mirrorPublicState(db, roomId, publicState) {
  const { error } = await db
    .from('dohatti_games')
    .upsert({ room_id: roomId, state: publicState, updated_at: new Date().toISOString() })
  if (error) throw error
}

// ---- statistics: one row per finished game + one summary row per match (room) ----
async function recordGameStats(db, roomId, st, trumpCard) {
  const [{ data: room }, { data: seats }] = await Promise.all([
    db.from('dohatti_rooms').select('code').eq('id', roomId).maybeSingle(),
    db.from('dohatti_players').select('seat, display_name, is_ai').eq('room_id', roomId).order('seat'),
  ])
  const r = st.result
  const players = (seats || []).map((s) => ({ seat: s.seat, name: s.display_name, is_ai: s.is_ai }))
  const iso = (ms) => new Date(ms).toISOString()
  const letter = (t) => (t === 0 ? 'A' : 'B')

  const { error: logError } = await db.from('dohatti_game_log').insert({
    room_id: roomId,
    room_code: room?.code ?? '?',
    game_no: st.gameNo,
    started_at: iso(st.gameStartedAt),
    ended_at: iso(st.finishedAt),
    duration_seconds: r.durationSeconds,
    dealer_seat: st.dealer,
    caller_seat: st.caller,
    calling_team: letter(r.callingTeam),
    bid: r.bid,
    trump_suit: trumpCard ? trumpCard[0] : null,
    trump_revealed_at_trick: st.revealedAtTrick,
    made: r.made,
    calling_points: r.callingPoints,
    defender_points: r.defenderPoints,
    score_change_a: r.delta[0],
    score_change_b: r.delta[1],
    score_after_a: r.tally[0],
    score_after_b: r.tally[1],
    court_won_by: r.courtWonBy === null ? null : letter(r.courtWonBy),
    tricks_played: st.trickCount,
    players,
  })
  if (logError) throw logError

  const { error: matchError } = await db.from('dohatti_match_stats').upsert({
    room_id: roomId,
    room_code: room?.code ?? '?',
    started_at: iso(st.matchStartedAt),
    last_game_ended_at: iso(st.finishedAt),
    match_seconds: Math.max(0, Math.round((st.finishedAt - st.matchStartedAt) / 1000)),
    games_played: st.gameNo,
    courts_a: st.courts[0],
    courts_b: st.courts[1],
    score_a: st.scores[0],
    score_b: st.scores[1],
    players,
  })
  if (matchError) throw matchError
}

// Compare-and-swap: only saves if nobody else changed the game in the meantime.
// Returns false when we lost the race.
export async function saveEngine(db, roomId, expectedVersion, { state, hands, trump }) {
  const version = expectedVersion + 1
  const publicState = { ...state, version }
  const { data, error } = await db
    .from('dohatti_engine')
    .update({ version, state: publicState, hands, trump, updated_at: new Date().toISOString() })
    .eq('room_id', roomId)
    .eq('version', expectedVersion)
    .select('room_id')
  if (error) throw error
  if (!data || data.length === 0) return false
  await mirrorPublicState(db, roomId, publicState)

  // Runs exactly once per finished game (only one writer can win the compare-and-swap above).
  if (publicState.phase === 'finished' && publicState.result) {
    try {
      await recordGameStats(db, roomId, publicState, trump)
    } catch (e) {
      console.error('dohatti: could not save statistics', e) // never break the game for stats
    }
  }
  return true
}

export async function dealNewGame(db, roomId, prev) {
  const now = Date.now()
  const hands = engine.dealHands(engine.shuffle(engine.createDeck()))
  const state = prev ? engine.startNextGame(prev.state, now) : engine.newGameState({ dealer: 0, now })

  if (prev) {
    return saveEngine(db, roomId, prev.version, { state, hands, trump: null })
  }

  const publicState = { ...state, version: 1 }
  const { error } = await db
    .from('dohatti_engine')
    .insert({ room_id: roomId, version: 1, state: publicState, hands, trump: null })
  if (error) throw error
  await mirrorPublicState(db, roomId, publicState)
  return true
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// The room's bot style ('secure' | 'normal' | 'aggressive') and code. Works even before the
// bot_risk column exists (then every room plays 'normal').
async function loadRoomInfo(db, roomId) {
  let { data, error } = await db.from('dohatti_rooms').select('code, bot_risk').eq('id', roomId).maybeSingle()
  if (error) {
    const retry = await db.from('dohatti_rooms').select('code').eq('id', roomId).maybeSingle()
    data = retry.data
  }
  return {
    exists: !!data,
    code: data?.code ?? null,
    risk: engine.BOT_RISKS.includes(data?.bot_risk) ? data.bot_risk : 'normal',
  }
}

// One row per AI decision, for later analysis. Never allowed to break the game.
async function logDecision(db, row) {
  try {
    const { error } = await db.from('dohatti_ai_log').insert(row)
    if (error) console.warn('dohatti: could not write the AI log:', error.message)
  } catch (e) {
    console.warn('dohatti: could not write the AI log:', e?.message || e)
  }
}

// Plays moves for AI seats until it is a human's turn (or the game ends).
export async function runAI(db, roomId) {
  for (let i = 0; i < 80; i++) {
    const eng = await loadEngine(db, roomId)
    if (!eng || eng.state.phase === 'finished') return

    const room = await loadRoomInfo(db, roomId)
    if (!room.exists) return
    const risk = room.risk

    const { data: seats, error } = await db
      .from('dohatti_players')
      .select('seat, is_ai, display_name')
      .eq('room_id', roomId)
    if (error) throw error
    const names = [0, 1, 2, 3].map(
      (n) => seats.find((s) => s.seat === n)?.display_name || `Seat ${n + 1}`
    )

    const actor = eng.state.turn
    if (!seats.find((s) => s.seat === actor)?.is_ai) return

    await sleep(AI_DELAY_MS)

    const state = eng.state
    let result
    let decision
    let phase
    let logHand
    let revealedBeforePlay = null
    let logState = state
    let trump = eng.trump // the hidden trump CARD, e.g. "S14"
    let hands = eng.hands

    if (state.phase === 'bidding') {
      phase = 'bid'
      const hand5 = engine.visibleHand(hands[actor], 'bidding')
      logHand = hand5
      decision = await agent.decideBid({ hand5, seat: actor, state, names, risk })
      result = engine.placeBid(state, actor, decision.bid)
    } else if (state.phase === 'choosing_trump') {
      phase = 'trump_card'
      const hand5 = engine.visibleHand(hands[actor], 'choosing_trump')
      logHand = hand5
      decision = await agent.decideTrumpCard({ hand5, seat: actor, state, names, risk })
      result = engine.chooseTrumpCard(state, hands, actor, decision.card)
      if (!result.error) {
        hands = result.hands
        trump = result.trumpCard
      }
    } else {
      phase = 'play'
      // Bots always reveal trump when they cannot follow suit (this also forces them to play trump).
      let current = state
      if (!current.trumpRevealed && engine.isVoidInLedSuit(current, hands[actor])) {
        const rv = engine.revealTrump(current, hands, trump, actor)
        if (!rv.error) {
          current = rv.state
          hands = rv.hands
          revealedBeforePlay = 'void'
        }
      }
      logState = current
      logHand = hands[actor]
      decision = await agent.decidePlay({ state: current, hand: hands[actor], seat: actor, trumpCard: trump, names, risk })
      result = engine.playCard(current, hands, trump, actor, decision.card)
      if (!result.error) hands = result.hands
    }

    if (result.error) {
      console.error('AI produced an invalid move:', result.error)
      return
    }

    // Small red / green signal in the bot's box: green = fine (or an automatic move), red = the model failed.
    result.state.signals = { ...(result.state.signals || {}), [actor]: decision.meta.ok ? 'g' : 'r' }

    const saved = await saveEngine(db, roomId, eng.version, { state: result.state, hands, trump })
    if (!saved) return // someone else moved first; they will continue the loop

    // Only moves that were really played are logged.
    await logDecision(
      db,
      buildAiLogRow({
        roomId,
        roomCode: room.code,
        state: logState,
        seat: actor,
        phase,
        risk,
        decision,
        hand: logHand,
        trumpCard: trump,
        revealedBeforePlay,
      })
    )
  }
}
