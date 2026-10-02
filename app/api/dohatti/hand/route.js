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
    if (!eng) return json({ seat: seat.seat, hand: [], trumpCard: null })

    const phase = eng.state.phase
    const hand = visibleHand(eng.hands[seat.seat], phase)

    // The caller is reminded of their hidden trump card while it is still face down.
    const showHidden =
      seat.seat === eng.state.caller && phase === 'playing' && !eng.state.trumpRevealed
    return json({ seat: seat.seat, hand, trumpCard: showHidden ? eng.trump : null })
  } catch (e) {
    console.error('dohatti hand error', e)
    return json({ error: e.message || 'Server error.' }, 500)
  }
}
