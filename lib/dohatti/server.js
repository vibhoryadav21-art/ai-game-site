// SERVER-ONLY helpers. Never import this file from a browser component.
// It uses the Supabase SERVICE ROLE key, which can read and write everything.

import { createClient } from '@supabase/supabase-js'
import { createHash } from 'crypto'
import * as engine from '@/lib/dohatti/engine'
import * as agent from '@/lib/dohatti/agent'

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
  return true
}

export async function dealNewGame(db, roomId, prev) {
  const dealer = prev ? engine.nextSeat(prev.state.dealer) : 0
  const hands = engine.dealHands(engine.shuffle(engine.createDeck()))
  const state = engine.newGameState(dealer)

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

// Plays moves for AI seats until it is a human's turn (or the game ends).
export async function runAI(db, roomId) {
  for (let i = 0; i < 60; i++) {
    const eng = await loadEngine(db, roomId)
    if (!eng || eng.state.phase === 'finished') return

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

    const hand = eng.hands[actor]
    let result
    let trump = eng.trump
    let hands = eng.hands

    if (eng.state.phase === 'choosing_trump') {
      const firstFive = engine.visibleHand(hand, 'choosing_trump')
      const decision = await agent.decideTrump({ firstFive, seat: actor, names })
      result = engine.chooseTrump(eng.state, actor, decision.suit)
      if (!result.error) {
        trump = result.trump
        // Public note: the suit itself stays secret.
        result.state.aiNote = { seat: actor, kind: 'trump', source: decision.source, text: decision.text }
      }
    } else {
      const decision = await agent.decidePlay({
        state: eng.state,
        hand,
        seat: actor,
        secretTrump: eng.trump,
        names,
      })
      result = engine.playCard(eng.state, hand, eng.trump, actor, decision.card)
      if (!result.error) {
        hands = eng.hands.map((h, idx) => (idx === actor ? result.hand : h))
        result.state.aiNote = {
          seat: actor,
          kind: 'play',
          card: decision.card,
          source: decision.source,
          text: decision.text,
        }
      }
    }

    if (result.error) {
      console.error('AI produced an invalid move:', result.error)
      return
    }

    const saved = await saveEngine(db, roomId, eng.version, { state: result.state, hands, trump })
    if (!saved) return // someone else moved first; they will continue the loop
  }
}
