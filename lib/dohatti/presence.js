// When does a bot take over for a human? Pure functions (no imports), used by the server and by tests.
//
// Every browser that has the game open sends a "heartbeat" every 10 seconds while the page is visible.
// A player counts as ABSENT when no heartbeat arrived for 25 seconds (tab closed, phone locked, no network).
//
// A bot plays for a human ("autopilot") only when it is THAT human's turn and:
//   * the human is absent and the turn has been waiting 8 seconds, or 3 seconds if they were already
//     on autopilot (so an absent player does not slow every round down), or
//   * the human is present but has not played for 2 minutes.
// As soon as the human plays again, autopilot ends.

export const HEARTBEAT_MS = 10_000
export const ABSENT_AFTER_MS = 25_000
export const ABSENT_WAIT_MS = 8_000
export const ON_AUTOPILOT_WAIT_MS = 3_000
export const TURN_LIMIT_MS = 120_000

// How long (ms) to wait before asking the server to check this turn. Used by the browsers.
export function kickDelay(state, actorIsBot) {
  if (actorIsBot) return 5_000
  if (state.signals?.[state.turn] === 'z') return ON_AUTOPILOT_WAIT_MS + 1_000
  return ABSENT_WAIT_MS + 4_000
}

export function isAbsent(lastSeenMs, now) {
  return lastSeenMs === null || lastSeenMs === undefined || now - lastSeenMs > ABSENT_AFTER_MS
}

// seatRow: { seat, is_ai, player_id }   lastSeenMs: number | null
export function autopilotDue({ state, seatRow, lastSeenMs, now }) {
  if (!state || state.phase === 'finished') return false
  if (!seatRow || seatRow.is_ai || !seatRow.player_id) return false
  if (state.turn !== seatRow.seat) return false

  const waited = now - (state.turnStartedAt ?? now)
  if (isAbsent(lastSeenMs, now)) {
    const alreadyOnAutopilot = state.signals?.[seatRow.seat] === 'z'
    return waited >= (alreadyOnAutopilot ? ON_AUTOPILOT_WAIT_MS : ABSENT_WAIT_MS)
  }
  return waited >= TURN_LIMIT_MS
}
