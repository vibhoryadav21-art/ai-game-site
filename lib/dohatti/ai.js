// Stage 1 AI player: a simple rule-based bot.
//
// An "agent" is just a function that looks at what ONE player is allowed to see
// and returns an action. Both functions below only use information that a real
// player in that seat would have. Later we can replace choosePlay with an
// LLM-based agent that has exactly the same inputs and outputs.

import { SUITS, suitOf, rankOf, legalCards, trickWinner, cardPower } from './engine'

// firstFive = the 5 cards the caller can see when choosing trump.
export function chooseTrump(firstFive) {
  let best = SUITS[0]
  let bestScore = -1
  for (const suit of SUITS) {
    const cards = firstFive.filter((c) => suitOf(c) === suit)
    const score = cards.length * 100 + cards.reduce((sum, c) => sum + rankOf(c), 0)
    if (score > bestScore) {
      best = suit
      bestScore = score
    }
  }
  return best
}

// state = public game state, hand = this bot's full hand, seat = this bot's seat,
// secretTrump = the real trump (the bot only uses it if it is the caller).
export function choosePlay({ state, hand, seat, secretTrump }) {
  const legal = legalCards(hand, state.trick)

  // What this bot legitimately knows about trump.
  const knownTrump = state.trumpRevealed ? state.trump : seat === state.caller ? secretTrump : null

  // Leading a trick: play the highest non-trump card, else the lowest trump.
  if (state.trick.length === 0) {
    const nonTrump = legal.filter((c) => suitOf(c) !== knownTrump)
    if (nonTrump.length > 0) {
      return [...nonTrump].sort((a, b) => rankOf(b) - rankOf(a))[0]
    }
    return [...legal].sort((a, b) => rankOf(a) - rankOf(b))[0]
  }

  // Following: try to win cheaply, but never overtake a winning partner.
  const ledSuit = suitOf(state.trick[0].card)
  const partner = (seat + 2) % 4
  const power = (c) => cardPower(c, ledSuit, knownTrump)
  const lowToHigh = [...legal].sort((a, b) => power(a) - power(b) || rankOf(a) - rankOf(b))

  if (trickWinner(state.trick, knownTrump) === partner) return lowToHigh[0]

  const winners = lowToHigh.filter(
    (c) => trickWinner([...state.trick, { seat, card: c }], knownTrump) === seat
  )
  if (winners.length > 0) return winners[0]
  return lowToHigh[0]
}
