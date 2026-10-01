import { adminClient, findSeat, loadEngine } from '@/lib/dohatti/server'
import { visibleHand } from '@/lib/dohatti/engine'

const json = (data, status = 200) => Response.json(data, { status })

// Returns ONLY the cards of the player who asks (proved by their secret).
export async function POST(request) {
  try {
    const { roomId, secret } = await request.json()
    const db = adminClient()

    const seat = await findSeat(db, roomId, secret)
    if (!seat) return json({ error: 'You are not seated in this room.' }, 403)

    const eng = await loadEngine(db, roomId)
    if (!eng) return json({ seat: seat.seat, hand: [], trump: null })

    const hand = visibleHand(eng.hands[seat.seat], eng.state.phase)

    // The caller may be reminded of the trump they chose while it is still hidden.
    const showTrump =
      seat.seat === eng.state.caller &&
      eng.state.phase === 'playing' &&
      !eng.state.trumpRevealed
    return json({ seat: seat.seat, hand, trump: showTrump ? eng.trump : null })
  } catch (e) {
    console.error('dohatti hand error', e)
    return json({ error: e.message || 'Server error.' }, 500)
  }
}
