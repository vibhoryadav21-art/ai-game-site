// Do Hatti game engine v2: pure functions, no database, no UI.
//
// Cards are strings: suit letter + rank number. "S14" = Ace of Spades, "H10" = Ten of Hearts.
// Ranks: 2..10, 11=J, 12=Q, 13=K, 14=A.
// Seats 0..3 play in the order 0 -> 1 -> 2 -> 3 -> 0. Partners sit opposite:
// Team A (index 0) = seats 0 and 2, Team B (index 1) = seats 1 and 3.
//
// ------------------------------- THE RULES -------------------------------
// DEAL    The dealer deals 13 cards each. Everyone first sees only their first 5.
// BIDDING Starting with the player after the dealer, then the next seats in order and
//         the dealer last, each player gets ONE turn to bid 10, 11 or 13 (a bid is the
//         number of tricks their team promises to collect) or pass. A bid must beat the
//         current bid. The first bidder cannot pass. A bid of 13 ends the bidding at once.
// TRUMP   The highest bidder is the "caller". The caller sets ONE of their first 5 cards
//         aside, face down. Its suit is the trump suit. The caller cannot play that card
//         until trump is revealed. Then all players see their full hand.
// PLAY    The caller leads the first trick. You must follow suit if you can.
// REVEAL  The caller can reveal trump at any moment (button). Any other player who cannot
//         follow the led suit may CHOOSE to reveal on their turn, or just discard any card
//         without revealing (a discard never wins the trick while trump is hidden). A player
//         who reveals because they are out of the led suit must then play a trump card if they
//         have one. Revealing puts the hidden card back into the caller's hand. The caller is
//         also forced to reveal when the hidden card is the only card they have left.
//         Bots always reveal when they cannot follow suit.
// PILE    Every trick goes into a shared pile that belongs to nobody. Once trump has been
//         revealed, when the SAME PLAYER wins two tricks in a row, their team takes the
//         whole pile (1 point per trick). The trick during which trump is revealed counts as
//         the first of the two. Whoever wins the 13th trick takes what is left.
// END     The game ends the moment the calling team has collected its bid, or can no longer
//         collect it (13 minus the other team's points is less than the bid).
// TALLY   One shared tally: Team A's score is always the opposite of Team B's. Calling team
//         made its bid: it gains the points it collected and the other team loses the same.
//         Missed: the calling team loses 2 x its bid and the other team gains the same.
// DEALER  If the dealer's team is below zero, the same dealer deals again. Otherwise the
//         deal passes to the next seat (the opponent to the dealer's left).
// COURT   When a team's tally reaches +52 (the other team's reaches -52) it wins a Court.
//         The tally resets to 0 and the dealer's partner deals next.

export const SUITS = ['S', 'H', 'D', 'C']
export const SUIT_SYMBOL = { S: '♠', H: '♥', D: '♦', C: '♣' }
export const SUIT_NAME = { S: 'Spades', H: 'Hearts', D: 'Diamonds', C: 'Clubs' }

export const BIDS = [10, 11, 13] // allowed bids
export const COURT_AT = 52 // a tally of +52 / -52 wins a Court
export const STREAK_TO_CLAIM = 2 // tricks in a row (same player) that claim the pile

export const suitOf = (card) => card[0]
export const rankOf = (card) => parseInt(card.slice(1), 10)
export const teamOf = (seat) => seat % 2 // 0 = Team A, 1 = Team B
export const nextSeat = (seat) => (seat + 1) % 4

const clone = (x) => JSON.parse(JSON.stringify(x))

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

// 4 hands of 13 cards. The first 5 cards of each hand are the "first deal".
export function dealHands(deck) {
  const hands = [[], [], [], []]
  deck.forEach((card, i) => hands[i % 4].push(card))
  return hands
}

export function newGameState({
  dealer = 0,
  scores = [0, 0],
  courts = [0, 0],
  gameNo = 1,
  matchStartedAt,
  now = Date.now(),
} = {}) {
  const order = [1, 2, 3, 4].map((n) => (dealer + n) % 4) // player after dealer ... dealer last
  return {
    phase: 'bidding', // 'bidding' | 'choosing_trump' | 'playing' | 'finished'
    gameNo,
    matchStartedAt: matchStartedAt ?? now,
    gameStartedAt: now,
    finishedAt: null,

    dealer,
    scores: [...scores], // running tally of the match
    courts: [...courts],
    nextDealer: null,

    bidding: { order, index: 0, current: null, bidder: null, history: [] },
    bid: null,
    caller: null,
    callingTeam: null,

    turn: order[0],
    leader: null,
    trick: [], // [{ seat, card }]
    lastTrick: null, // { cards, winner }
    trickCount: 0,

    trumpRevealed: false,
    trump: null, // suit, only filled in once revealed
    revealedBy: null,
    revealedAtTrick: null,

    pot: 0, // tricks nobody owns yet
    points: [0, 0], // points claimed in this game
    lastWinner: null, // winner of the previous trick, if it counts toward a streak

    handSizes: [13, 13, 13, 13], // counts the caller's hidden card too
    played: [],
    aiNote: null,
    result: null,
  }
}

// Used when the host deals again after a finished game.
export function startNextGame(prev, now = Date.now()) {
  return newGameState({
    dealer: prev.nextDealer ?? 0,
    scores: prev.scores ?? [0, 0],
    courts: prev.courts ?? [0, 0],
    gameNo: (prev.gameNo ?? 0) + 1,
    matchStartedAt: prev.matchStartedAt,
    now,
  })
}

// While bidding and choosing trump a player only sees their first 5 cards.
export function visibleHand(hand, phase) {
  return phase === 'bidding' || phase === 'choosing_trump' ? hand.slice(0, 5) : hand
}

export function legalCards(hand, trick) {
  if (trick.length === 0) return [...hand]
  const led = suitOf(trick[0].card)
  const following = hand.filter((c) => suitOf(c) === led)
  return following.length > 0 ? following : [...hand]
}

// Is this seat out of the suit that was led? (false when leading the trick)
export function isVoidInLedSuit(state, hand) {
  if (state.trick.length === 0) return false
  const led = suitOf(state.trick[0].card)
  return !hand.some((c) => suitOf(c) === led)
}

// Cards the seat may play right now. Normal rule: follow suit if you can. Extra rule:
// a player who revealed trump during this trick while out of the led suit must play a
// trump card if they have one.
export function legalPlays(state, hand, seat) {
  const base = legalCards(hand, state.trick)
  if (
    state.trumpRevealed &&
    state.revealedBy === seat &&
    state.revealedAtTrick === state.trickCount + 1 &&
    isVoidInLedSuit(state, hand)
  ) {
    const trumps = hand.filter((c) => suitOf(c) === state.trump)
    if (trumps.length > 0) return trumps
  }
  return base
}

// May this seat press "Reveal trump" right now?
// The caller: any time. Everyone else: only on their own turn while out of the led suit.
export function canReveal(state, hand, seat) {
  if (state.phase !== 'playing' || state.trumpRevealed) return false
  if (seat === state.caller) return true
  return state.turn === seat && isVoidInLedSuit(state, hand)
}

function beats(card, best, trump) {
  const cs = suitOf(card)
  const bs = suitOf(best)
  if (cs === bs) return rankOf(card) > rankOf(best)
  return !!trump && cs === trump // best is not trump (different suit)
}

// Seat that currently wins a (possibly unfinished) trick.
export function trickWinner(trick, trump) {
  let best = trick[0]
  for (const play of trick.slice(1)) {
    if (beats(play.card, best.card, trump)) best = play
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

// ------------------------------- bidding -------------------------------

// amount: 10, 11, 13 or 'pass'
export function placeBid(state, seat, amount) {
  if (state.phase !== 'bidding') return { error: 'Bidding is over.' }
  if (state.turn !== seat) return { error: 'It is not your turn to bid.' }

  const s = clone(state)
  s.aiNote = null
  const b = s.bidding
  const isFirst = b.index === 0

  if (amount === 'pass') {
    if (isFirst) return { error: 'The first bidder must bid.' }
    b.history.push({ seat, bid: 'pass' })
  } else {
    if (!BIDS.includes(amount)) return { error: 'Invalid bid.' }
    if (b.current !== null && amount <= b.current) return { error: 'You must bid higher.' }
    b.current = amount
    b.bidder = seat
    b.history.push({ seat, bid: amount })
  }

  b.index += 1
  const closed = amount === 13 || b.index >= 4
  if (!closed) {
    s.turn = b.order[b.index]
    return { state: s }
  }

  s.phase = 'choosing_trump'
  s.caller = b.bidder
  s.bid = b.current
  s.callingTeam = teamOf(b.bidder)
  s.turn = b.bidder
  s.leader = b.bidder
  return { state: s }
}

// The caller sets one of their first 5 cards aside as the hidden trump card.
// Returns { error } or { state, hands, trumpCard }.
export function chooseTrumpCard(state, hands, seat, card) {
  if (state.phase !== 'choosing_trump') return { error: 'The trump card has already been chosen.' }
  if (seat !== state.caller) return { error: 'Only the caller chooses the trump card.' }
  if (!hands[seat].slice(0, 5).includes(card)) {
    return { error: 'Choose one of your first 5 cards.' }
  }
  const s = clone(state)
  s.phase = 'playing'
  s.aiNote = null
  const newHands = hands.map((h, i) => (i === seat ? h.filter((c) => c !== card) : h))
  return { state: s, hands: newHands, trumpCard: card }
}

// ------------------------------- reveal -------------------------------

// Mutates s. Returns the new hands (the hidden card goes back to the caller).
function applyReveal(s, hands, trumpCard, by) {
  s.trumpRevealed = true
  s.trump = suitOf(trumpCard)
  s.revealedBy = by
  s.revealedAtTrick = s.trickCount + 1
  return hands.map((h, i) => (i === s.caller ? [...h, trumpCard] : h))
}

// Reveals trump. Allowed for the caller at any moment, and for another player on their
// own turn when they cannot follow suit. Returns { error } or { state, hands }.
export function revealTrump(state, hands, trumpCard, seat) {
  if (state.phase !== 'playing') return { error: 'The game is not in the playing phase.' }
  if (state.trumpRevealed) return { error: 'Trump is already revealed.' }
  if (!canReveal(state, hands[seat], seat)) {
    return {
      error:
        seat === state.caller
          ? 'You cannot reveal right now.'
          : 'You can only reveal on your turn when you cannot follow suit.',
    }
  }
  const s = clone(state)
  s.aiNote = null
  const newHands = applyReveal(s, hands, trumpCard, seat)
  return { state: s, hands: newHands }
}

// The caller is forced to reveal when the hidden card is the only card they have left.
function autoRevealForCaller(s, hands, trumpCard) {
  if (s.phase !== 'playing' || s.trumpRevealed || s.turn !== s.caller) return hands
  return hands[s.caller].length === 0 ? applyReveal(s, hands, trumpCard, s.caller) : hands
}

// ------------------------------- playing -------------------------------

// hands = all 4 hands (the caller's hand does NOT contain the hidden card until revealed).
// Returns { error } or { state, hands }.
export function playCard(state, hands, trumpCard, seat, card, now = Date.now()) {
  if (state.phase !== 'playing') return { error: 'The game is not in the playing phase.' }
  if (state.turn !== seat) return { error: 'It is not your turn.' }
  if (!hands[seat].includes(card)) return { error: 'You do not hold that card.' }
  if (!legalPlays(state, hands[seat], seat).includes(card)) {
    return {
      error:
        state.revealedBy === seat && state.revealedAtTrick === state.trickCount + 1
          ? 'You revealed trump, so you must play a trump card.'
          : 'You must follow suit.',
    }
  }

  const s = clone(state)
  s.aiNote = null
  let H = hands

  H = H.map((h, i) => (i === seat ? h.filter((c) => c !== card) : h))
  s.trick.push({ seat, card })
  s.played.push(card)
  s.handSizes[seat] -= 1

  if (s.trick.length < 4) {
    s.turn = nextSeat(seat)
    H = autoRevealForCaller(s, H, trumpCard)
    return { state: s, hands: H }
  }

  // ---- trick complete ----
  const winner = trickWinner(s.trick, s.trumpRevealed ? s.trump : null)
  s.pot += 1
  s.trickCount += 1
  s.lastTrick = { cards: s.trick, winner }
  s.trick = []
  s.leader = winner
  s.turn = winner

  if (s.trumpRevealed) {
    // Same player twice in a row (after the reveal) claims the pile for their team.
    if (s.lastWinner === winner) {
      s.points[teamOf(winner)] += s.pot
      s.pot = 0
      s.lastWinner = null
    } else {
      s.lastWinner = winner
    }
  } else {
    s.lastWinner = null
  }

  if (s.trickCount === 13) {
    s.points[teamOf(winner)] += s.pot // whoever wins the last trick takes the rest
    s.pot = 0
    finishGame(s, now)
    return { state: s, hands: H }
  }

  const calling = s.points[s.callingTeam]
  const defending = s.points[1 - s.callingTeam]
  if (calling >= s.bid || 13 - defending < s.bid) {
    finishGame(s, now)
    return { state: s, hands: H }
  }

  H = autoRevealForCaller(s, H, trumpCard)
  return { state: s, hands: H }
}

// Scores the game, updates the shared tally, decides the next dealer. Mutates s.
function finishGame(s, now) {
  const callingPoints = s.points[s.callingTeam]
  const defenderPoints = s.points[1 - s.callingTeam]
  const made = callingPoints >= s.bid

  // What the calling team gains (or loses). The other team gets the exact opposite.
  const callingGain = made ? callingPoints : -2 * s.bid
  const deltaA = s.callingTeam === 0 ? callingGain : -callingGain
  const delta = [deltaA, -deltaA]

  const scoresBefore = [...s.scores]
  const tallyA = scoresBefore[0] + deltaA
  const tally = [tallyA, -tallyA] // Team B is always the opposite of Team A

  let scores = tally
  const courts = [...s.courts]
  let courtWonBy = null
  if (tallyA >= COURT_AT) courtWonBy = 0
  else if (tallyA <= -COURT_AT) courtWonBy = 1

  let nextDealer
  if (courtWonBy !== null) {
    courts[courtWonBy] += 1
    scores = [0, 0]
    nextDealer = (s.dealer + 2) % 4 // the dealer's partner
  } else {
    nextDealer = tally[teamOf(s.dealer)] < 0 ? s.dealer : nextSeat(s.dealer)
  }

  s.phase = 'finished'
  s.finishedAt = now
  s.scores = scores
  s.courts = courts
  s.nextDealer = nextDealer
  s.result = {
    made,
    bid: s.bid,
    callingTeam: s.callingTeam,
    callingPoints,
    defenderPoints,
    delta,
    scoresBefore,
    tally, // scores right after this game, before any Court reset
    courtWonBy,
    durationSeconds: Math.max(0, Math.round((now - s.gameStartedAt) / 1000)),
  }
}
