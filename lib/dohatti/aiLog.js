// Builds one row for the dohatti_ai_log table. No imports, so it can be tested on its own.
// The keys of the returned object are exactly the column names of the table.

const suitOf = (card) => card[0]

// What the bot knew about trump at that moment (never more than a real player in that seat knows).
function knownTrump(state, seat, trumpCard) {
  if (state.trumpRevealed) return state.trump
  if (seat === state.caller && trumpCard) return suitOf(trumpCard)
  return null
}

export function buildAiLogRow({ roomId, roomCode, state, seat, phase, risk, decision, hand, trumpCard, revealedBeforePlay }) {
  const meta = decision.meta || {}
  const choiceRaw = decision.bid ?? decision.card ?? null
  const bidding = state.bidding || {}

  return {
    room_id: roomId,
    room_code: roomCode ?? null,
    game_no: state.gameNo ?? null,
    move_no: phase === 'bid' ? bidding.index ?? null : phase === 'play' ? (state.played || []).length : 0,
    phase,
    seat,
    team: seat % 2 === 0 ? 'A' : 'B',
    bot_risk: risk,

    source: meta.source ?? decision.source,
    ok: meta.ok ?? decision.source !== 'rules-fallback',
    model: meta.model ?? null,
    attempts: meta.attempts ?? 0,
    error_kind: meta.errorKind ?? null,
    error_detail: meta.errorDetail ?? null,
    latency_ms: meta.latencyMs ?? null,
    tokens_in: meta.tokensIn ?? null,
    tokens_out: meta.tokensOut ?? null,

    choice: choiceRaw === null ? null : String(choiceRaw),
    legal: meta.legal ?? null,
    reason: meta.reason ?? null,
    hand: hand ?? null,
    revealed_before_play: revealedBeforePlay ?? null,
    context: {
      bid: state.bid ?? null,
      bid_so_far: phase === 'bid' ? bidding.current ?? null : undefined,
      caller: state.caller ?? null,
      calling_team: state.callingTeam === null || state.callingTeam === undefined ? null : state.callingTeam === 0 ? 'A' : 'B',
      trick_no: state.trickCount + 1,
      pile: state.pot,
      points: state.points,
      trump_revealed: !!state.trumpRevealed,
      trump_suit_known: knownTrump(state, seat, trumpCard),
      last_winner: state.lastWinner ?? null,
      trick: (state.trick || []).map((p) => ({ seat: p.seat, card: p.card })),
      tally: state.scores,
    },
  }
}
