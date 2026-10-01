import { adminClient, findSeat, loadEngine, dealNewGame, runAI } from '@/lib/dohatti/server'

export const maxDuration = 30

const json = (data, status = 200) => Response.json(data, { status })

// Host only. Starts the first game, or deals a new game after one has finished.
export async function POST(request) {
  try {
    const { roomId, secret } = await request.json()
    const db = adminClient()

    const seat = await findSeat(db, roomId, secret)
    if (!seat) return json({ error: 'You are not seated in this room.' }, 403)

    const { data: room, error: roomError } = await db
      .from('dohatti_rooms')
      .select('*')
      .eq('id', roomId)
      .single()
    if (roomError || !room) return json({ error: 'Room not found.' }, 404)
    if (room.host_id !== seat.player_id) return json({ error: 'Only the host can do that.' }, 403)

    const { data: seats, error: seatsError } = await db
      .from('dohatti_players')
      .select('*')
      .eq('room_id', roomId)
    if (seatsError) throw seatsError
    if (seats.length !== 4 || !seats.every((s) => s.player_id || s.is_ai)) {
      return json({ error: 'All 4 seats need a player or an AI.' }, 400)
    }

    const prev = await loadEngine(db, roomId)
    if (prev && prev.state.phase !== 'finished') {
      return json({ error: 'A game is already in progress.' }, 400)
    }

    const ok = await dealNewGame(db, roomId, prev)
    if (!ok) return json({ error: 'Please try again.' }, 409)

    if (room.status !== 'playing') {
      const { error } = await db.from('dohatti_rooms').update({ status: 'playing' }).eq('id', roomId)
      if (error) throw error
    }

    await runAI(db, roomId)
    return json({ ok: true })
  } catch (e) {
    console.error('dohatti start error', e)
    return json({ error: e.message || 'Server error.' }, 500)
  }
}
