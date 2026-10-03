import { supabase } from '@/lib/supabaseClient'

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no 0/O/1/I

function makeCode() {
  let code = ''
  for (let i = 0; i < 5; i++) {
    code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]
  }
  return code
}

export async function createRoom(playerId, name) {
  // Rooms with no activity for 1 hour are deleted. Done here, whenever someone creates a room,
  // so no scheduler is needed (the function comes from supabase/dohatti-step8.sql; errors are ignored).
  try {
    await supabase.rpc('dohatti_cleanup')
  } catch {
    /* clean-up is optional */
  }

  for (let attempt = 0; attempt < 5; attempt++) {
    const code = makeCode()
    const { data: room, error } = await supabase
      .from('dohatti_rooms')
      .insert({ code, host_id: playerId })
      .select()
      .single()

    if (error) {
      if (error.code === '23505') continue // code already used, try another
      throw error
    }

    const seats = [0, 1, 2, 3].map((seat) => ({
      room_id: room.id,
      seat,
      player_id: seat === 0 ? playerId : null,
      display_name: seat === 0 ? name : '',
    }))
    const { error: seatError } = await supabase.from('dohatti_players').insert(seats)
    if (seatError) throw seatError
    return room
  }
  throw new Error('Could not create a unique room code. Please try again.')
}

export async function getRoomByCode(code) {
  const { data, error } = await supabase
    .from('dohatti_rooms')
    .select('*')
    .eq('code', code.trim().toUpperCase())
    .maybeSingle()
  if (error) throw error
  return data
}

export async function getSeats(roomId) {
  const { data, error } = await supabase
    .from('dohatti_players')
    .select('*')
    .eq('room_id', roomId)
    .order('seat')
  if (error) throw error
  return data
}

// Returns true if the seat was claimed, false if someone else got it first.
export async function claimSeat(roomId, seat, playerId, name) {
  const { data, error } = await supabase
    .from('dohatti_players')
    .update({ player_id: playerId, display_name: name })
    .eq('room_id', roomId)
    .eq('seat', seat)
    .eq('is_ai', false)
    .is('player_id', null)
    .select()
  if (error) throw error
  if (!data || data.length === 0) return false

  // free any other seat this player was sitting in
  const { error: freeError } = await supabase
    .from('dohatti_players')
    .update({ player_id: null, display_name: '' })
    .eq('room_id', roomId)
    .eq('player_id', playerId)
    .neq('seat', seat)
  if (freeError) throw freeError
  return true
}

export async function setSeatAI(roomId, seat, makeAI) {
  let query = supabase
    .from('dohatti_players')
    .update(
      makeAI
        ? { is_ai: true, display_name: `Bot ${seat + 1}` }
        : { is_ai: false, display_name: '' }
    )
    .eq('room_id', roomId)
    .eq('seat', seat)

  query = makeAI ? query.is('player_id', null).eq('is_ai', false) : query.eq('is_ai', true)

  const { error } = await query
  if (error) throw error
}

export async function fillWithAI(roomId) {
  const seats = await getSeats(roomId)
  for (const s of seats) {
    if (!s.player_id && !s.is_ai) await setSeatAI(roomId, s.seat, true)
  }
}

// Leaving a room that is still waiting frees the seat.
// Leaving a game in progress turns the seat into a bot so the game can continue.
export async function leaveRoom(room, playerId) {
  const inProgress = room.status === 'playing'

  await supabase
    .from('dohatti_players')
    .update(
      inProgress
        ? { player_id: null, is_ai: true, display_name: 'Bot' }
        : { player_id: null, display_name: '' }
    )
    .eq('room_id', room.id)
    .eq('player_id', playerId)

  const seats = await getSeats(room.id)
  const humans = seats.filter((s) => s.player_id)

  if (humans.length === 0) {
    await supabase.from('dohatti_rooms').delete().eq('id', room.id)
    return
  }
  if (room.host_id === playerId) {
    await supabase
      .from('dohatti_rooms')
      .update({ host_id: humans[0].player_id })
      .eq('id', room.id)
  }
}
