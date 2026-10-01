// Do Hatti game engine: pure functions, no database, no UI.
//
// Cards are strings: suit letter + rank number. "S14" = Ace of Spades,
// "H10" = Ten of Hearts, "D2" = Two of Diamonds. Ranks: 2..10, 11=J, 12=Q, 13=K, 14=A.
//
// Seats are numbered 0..3 and play goes 0 -> 1 -> 2 -> 3 -> 0.
// Partners sit opposite: Team A = seats 0 and 2, Team B = seats 1 and 3.
//
// Rules implemented (Court Piece / hidden trump):
//  1. 52 cards, 13 each. The dealer is seat 0 in the first game and rotates.
//  2. The player after the dealer (the "caller") sees only their first 5 cards
//     and secretly picks the trump suit. Then everyone sees all 13 cards.
//  3. The caller leads the first trick. You must follow the led suit if you can.
//  4. Trump stays HIDDEN until the first time someone cannot follow suit.
//     At that moment it is revealed to everybody, and that player may play any card.
//  5. A trick is won by the highest trump, or else the highest card of the led suit.
//     The winner leads the next trick.
//  6. After 13 tricks, the team with more tricks (7+) wins.

export const SUITS = ['S', 'H', 'D', 'C']
export const SUIT_SYMBOL = { S: '♠', H: '♥', D: '♦', C: '♣' }
export const SUIT_NAME = { S: 'Spades', H: 'Hearts', D: 'Diamonds', C: 'Clubs' }

export const suitOf = (card) => card[0]
export const rankOf = (card) => parseInt(card.slice(1), 10)
export const teamOf = (seat) => seat % 2 // 0 = Team A, 1 = Team B
export const nextSeat = (seat) => (seat + 1) % 4

export function createDeck() {
  const deck = []
  for (const s of SUITS) {
    for (let r = 2; r <= 14; r++) deck.push(`${s}${r}`)
  }
  return deck
}

export function shuffle(cards, rng = Math.random) {
  const a = [...cards]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// Returns 4 hands of 13 cards. The first 5 cards of each hand are the "first deal".
export function dealHands(deck) {
  const hands = [[], [], [], []]
  deck.forEach((card, i) => hands[i % 4].push(card))
  return hands
}

export function newGameState(dealer = 0) {
  const caller = nextSeat(dealer)
  return {
    phase: 'choosing_trump', // 'choosing_trump' | 'playing' | 'finished'
    dealer,
    caller,
    turn: caller,
    leader: caller,
    trick: [], // [{ seat, card }] cards on the table right now
    lastTrick: null, // { cards: [{ seat, card }], winner } the previous completed trick
    trumpRevealed: false,
    trump: null, // only filled in once revealed
    revealedBy: null,
    tricksWon: [0, 0], // [Team A, Team B]
    trickCount: 0,
    handSizes: [13, 13, 13, 13],
    winner: null, // 'A' | 'B' when finished
  }
}

// During trump selection a player may only see their first 5 cards.
export function visibleHand(hand, phase) {
  return phase === 'choosing_trump' ? hand.slice(0, 5) : hand
}

export function legalCards(hand, trick) {
  if (trick.length === 0) return [...hand]
  const led = suitOf(trick[0].card)
  const following = hand.filter((c) => suitOf(c) === led)
  return following.length > 0 ? following : [...hand]
}

function beats(card, best, led, trump) {
  const cs = suitOf(card)
  const bs = suitOf(best)
  if (cs === bs) return rankOf(card) > rankOf(best)
  if (trump && cs === trump) return true // best is not trump (different suit)
  return false
}

// Returns the seat that wins the (possibly unfinished) trick.
export function trickWinner(trick, trump) {
  const led = suitOf(trick[0].card)
  let best = trick[0]
  for (const play of trick.slice(1)) {
    if (beats(play.card, best.card, led, trump)) best = play
  }
  return best.seat
}

// Used by bots to compare cards inside one trick.
export function cardPower(card, ledSuit, trump) {
  const s = suitOf(card)
  if (trump && s === trump) return 100 + rankOf(card)
  if (s === ledSuit) return rankOf(card)
  return 0
}

export function chooseTrump(state, seat, suit) {
  if (state.phase !== 'choosing_trump') return { error: 'Trump has already been chosen.' }
  if (seat !== state.caller) return { error: 'Only the trump caller can choose trump.' }
  if (!SUITS.includes(suit)) return { error: 'Invalid suit.' }
  return { state: { ...state, phase: 'playing' }, trump: suit }
}

// hand = the full hand (13 cards) of the player who plays.
// secretTrump = the real trump suit from the private table.
// Returns { error } or { state, hand } where hand is the player's hand after the play.
export function playCard(state, hand, secretTrump, seat, card) {
  if (state.phase !== 'playing') return { error: 'The game is not in the playing phase.' }
  if (state.turn !== seat) return { error: 'It is not your turn.' }
  if (!hand.includes(card)) return { error: 'You do not hold that card.' }
  if (!legalCards(hand, state.trick).includes(card)) return { error: 'You must follow suit.' }

  const s = JSON.parse(JSON.stringify(state))

  // First player who cannot follow suit forces the trump to be revealed.
  if (s.trick.length > 0 && !s.trumpRevealed) {
    const led = suitOf(s.trick[0].card)
    if (suitOf(card) !== led) {
      s.trumpRevealed = true
      s.trump = secretTrump
      s.revealedBy = seat
    }
  }

  const newHand = hand.filter((c) => c !== card)
  s.trick.push({ seat, card })
  s.handSizes[seat] = newHand.length

  if (s.trick.length < 4) {
    s.turn = nextSeat(seat)
    return { state: s, hand: newHand }
  }

  // Trick complete
  const winnerSeat = trickWinner(s.trick, s.trumpRevealed ? s.trump : null)
  s.tricksWon[teamOf(winnerSeat)] += 1
  s.trickCount += 1
  s.lastTrick = { cards: s.trick, winner: winnerSeat }
  s.trick = []
  s.leader = winnerSeat
  s.turn = winnerSeat

  if (s.trickCount === 13) {
    s.phase = 'finished'
    s.winner = s.tricksWon[0] > s.tricksWon[1] ? 'A' : 'B'
  }
  return { state: s, hand: newHand }
}
