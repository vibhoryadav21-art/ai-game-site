// Stage 1 AI player: a simple rule-based bot. It is also the safety net when the
// language-model agent fails. Every function only uses information that a real
// player in that seat is allowed to see.

import { SUITS, suitOf, rankOf, legalCards, trickWinner, cardPower } from './engine'

function suitCounts(cards) {
  const counts = { S: 0, H: 0, D: 0, C: 0 }
  for (const c of cards) counts[suitOf(c)] += 1
  return counts
}

// Bid 10 / 11 / 13 or 'pass', based on the 5 cards the bot can see.
export function chooseBid({ hand5, current, isFirst }) {
  const longest = Math.max(...Object.values(suitCounts(hand5)))
  const honors = hand5.reduce((sum, c) => {
    const r = rankOf(c)
    return sum + (r === 14 ? 3 : r === 13 ? 2 : r === 12 ? 1 : 0)
  }, 0)
  const power = honors + (longest > 2 ? (longest - 2) * 1.5 : 0)

  let want = isFirst ? 10 : null // the first bidder is not allowed to pass
  if (power >= 9) want = 13
  else if (power >= 6) want = 11

  if (want === null) return 'pass'
  if (current !== null && want <= current) return 'pass'
  return want
}

// Pick which of the first 5 cards to hide as trump: the lowest card of the longest suit.
export function chooseTrumpCard(hand5) {
  const counts = suitCounts(hand5)
  let bestSuit = SUITS[0]
  let bestScore = -1
  for (const suit of SUITS) {
    const cards = hand5.filter((c) => suitOf(c) === suit)
    const score = counts[suit] * 100 + cards.reduce((sum, c) => sum + rankOf(c), 0)
    if (score > bestScore) {
      bestSuit = suit
      bestScore = score
    }
  }
  return hand5
    .filter((c) => suitOf(c) === bestSuit)
    .sort((a, b) => rankOf(a) - rankOf(b))[0]
}

// hand = the bot's VISIBLE hand (the hidden trump card is not in it).
// trumpCard = the hidden card; the bot only uses its suit if it is the caller.
export function choosePlay({ state, hand, seat, trumpCard }) {
  const legal = legalCards(hand, state.trick)
  const knownTrump = state.trumpRevealed
    ? state.trump
    : seat === state.caller && trumpCard
      ? suitOf(trumpCard)
      : null

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
