import { adminClient, findSeat, loadEngine, saveEngine, runAI } from '@/lib/dohatti/server'
import { chooseTrump, playCard } from '@/lib/dohatti/engine'

export const maxDuration = 30

const json = (data, status = 200) => Response.json(data, { status })

// type 'trump' -> { suit }, type 'play' -> { card }, type 'kick' -> nudges stuck bots.
export async function POST(request) {
  try {
    const { roomId, secret, type, suit, card } = await request.json()
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

    if (type === 'trump') {
      result = chooseTrump(eng.state, seat, suit)
      if (!result.error) trump = result.trump
    } else if (type === 'play') {
      result = playCard(eng.state, eng.hands[seat], eng.trump, seat, card)
      if (!result.error) hands = eng.hands.map((h, i) => (i === seat ? result.hand : h))
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
