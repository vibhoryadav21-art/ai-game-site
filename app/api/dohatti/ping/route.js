import { adminClient, findSeat } from '@/lib/dohatti/server'

const json = (data, status = 200) => Response.json(data, { status })

// "I am still here." Every browser with the game open calls this every 10 seconds while the page is visible.
// The server uses it to notice players who are away (see lib/dohatti/presence.js).
export async function POST(request) {
  try {
    const { roomId, secret } = await request.json()
    const db = adminClient()

    const seat = await findSeat(db, roomId, secret)
    if (!seat) return json({ error: 'You are not seated in this room.' }, 403)

    const { error } = await db
      .from('dohatti_presence')
      .upsert({ room_id: roomId, player_id: seat.player_id, last_seen: new Date().toISOString() })
    if (error) throw error
    return json({ ok: true })
  } catch (e) {
    return json({ error: e.message || 'Server error.' }, 500)
  }
}
