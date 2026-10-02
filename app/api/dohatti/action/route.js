import { adminClient, findSeat, loadEngine, saveEngine, runAI } from '@/lib/dohatti/server'
import { placeBid, chooseTrumpCard, callerReveal, playCard } from '@/lib/dohatti/engine'

export const maxDuration = 30

const json = (data, status = 200) => Response.json(data, { status })

// type 'bid' -> { amount: 10 | 11 | 13 | 'pass' }
// type 'trump' -> { card }     (the caller hides one of their first 5 cards)
// type 'play' -> { card }
// type 'reveal' -> caller reveals the trump
// type 'kick' -> nudges stuck bots
export async function POST(request) {
  try {
    const { roomId, secret, type, amount, card } = await request.json()
    const db = adminClient()

    const seatRow = await findSeat(db, roomId, secret)
    if (!seatRow) return json({ error: 'You are not seated in this room.' }, 403)

    if (type === 'kick') {
      await runAI(db, roomId)
      return json({ ok: true })
    }

    const eng = await loadEngine(db, roomId)
    if (!eng) return json({ error: 'The game has not started.' }, 400)

    const seat = seatRow.seat
    let result
    let trump = eng.trump
    let hands = eng.hands

    if (type === 'bid') {
      result = placeBid(eng.state, seat, amount === 'pass' ? 'pass' : Number(amount))
    } else if (type === 'trump') {
      result = chooseTrumpCard(eng.state, eng.hands, seat, card)
      if (!result.error) {
        hands = result.hands
        trump = result.trumpCard
      }
    } else if (type === 'play') {
      result = playCard(eng.state, eng.hands, eng.trump, seat, card)
      if (!result.error) hands = result.hands
    } else if (type === 'reveal') {
      result = callerReveal(eng.state, eng.hands, eng.trump, seat)
      if (!result.error) hands = result.hands
    } else {
      return json({ error: 'Unknown action.' }, 400)
    }

    if (result.error) return json({ error: result.error }, 400)

    const saved = await saveEngine(db, roomId, eng.version, { state: result.state, hands, trump })
    if (!saved) return json({ error: 'The game moved on. Please try again.' }, 409)

    await runAI(db, roomId)
    return json({ ok: true })
  } catch (e) {
    console.error('dohatti action error', e)
    return json({ error: e.message || 'Server error.' }, 500)
  }
}
