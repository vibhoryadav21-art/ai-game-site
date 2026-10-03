import { adminClient, findSeat, loadEngine, dealNewGame, runAI } from '@/lib/dohatti/server'

export const maxDuration = 30

const json = (data, status = 200) => Response.json(data, { status })

// Host: starts the first game. After a game has finished, ANY seated human may deal the next one
// (so a game is never stuck because the host went away).
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

    const { data: seats, error: seatsError } = await db
      .from('dohatti_players')
      .select('*')
      .eq('room_id', roomId)
    if (seatsError) throw seatsError
    if (seats.length !== 4 || !seats.every((s) => s.player_id || s.is_ai)) {
      return json({ error: 'All 4 seats need a player or an AI.' }, 400)
    }

    const prev = await loadEngine(db, roomId)
    // Only the host may start the very first game. Once a game exists, anybody at the table may deal.
    if (room.host_id !== seat.player_id && !prev) {
      return json({ error: 'Only the host can do that.' }, 403)
    }
    if (prev && prev.state.phase !== 'finished') {
      // A game is already running (for example the button was pressed twice): not an error.
      await runAI(db, roomId)
      return json({ ok: true, alreadyRunning: true })
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
