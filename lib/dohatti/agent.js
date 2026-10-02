// SERVER-ONLY. The AI agent: asks a Groq-hosted language model to play a seat.
//
// How an agent works, in four steps (read decidePlay below top to bottom):
//   1. OBSERVE  - build a text description of exactly what this seat may see.
//   2. THINK    - send it to the language model with the rules and an answer format.
//   3. VALIDATE - never trust the model: its choice must be on the legal list.
//   4. FALLBACK - if the model fails, times out or cheats, the rule bot plays instead.
//
// The game engine stays in charge of the rules. The model only ever picks from the
// legal choices, so a confused model can never break the game.
// The agent makes three kinds of decisions: a bid, the hidden trump card, and each card to play.

import { SUITS, SUIT_NAME, BIDS, suitOf, rankOf, legalPlays, trickWinner } from './engine'
import * as rules from './ai'

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions'
// Groq retires models over time, so check console.groq.com/docs/models if you get HTTP 404.
// Override with GROQ_MODEL in .env (e.g. openai/gpt-oss-20b is faster and cheaper).
const DEFAULT_MODEL = 'openai/gpt-oss-120b'
const TIMEOUT_MS = 10000
const RANK_NAME = { 11: 'Jack', 12: 'Queen', 13: 'King', 14: 'Ace' }

// Use the language model only when a key exists and DOHATTI_AI_MODE is not "rules".
const llmEnabled = () => !!process.env.GROQ_API_KEY && process.env.DOHATTI_AI_MODE !== 'rules'
// Set DOHATTI_SHOW_AI_REASONS=true to show the model's one-line reasoning to everyone at
// the table. Leave it off in real games: the reasoning can mention the bot's own cards.
const showReasons = () => process.env.DOHATTI_SHOW_AI_REASONS === 'true'

const describe = (card) => `${RANK_NAME[rankOf(card)] || rankOf(card)} of ${SUIT_NAME[suitOf(card)]} (${card})`
const describeList = (cards) => cards.map(describe).join(', ')
const teamLetter = (team) => (team === 0 ? 'A' : 'B')

const SYSTEM_PROMPT = `You are an expert player of Do Hatti, a 4-player partnership trick-taking card game with bidding and a hidden trump. You control ONE seat.

RULES
- 52 cards, 13 per player. Seats 0,1,2,3 play in that order, then back to 0. Partners sit opposite: seats 0 and 2 are Team A, seats 1 and 3 are Team B. Ranks high to low: Ace, King, Queen, Jack, 10 down to 2.
- BIDDING: each player sees only their first 5 cards and gets one turn to bid 10, 11 or 13 (the number of the 13 tricks their team promises to collect) or pass. A bid must beat the current bid. The highest bidder is the caller.
- TRUMP: the caller sets ONE of their first 5 cards aside, face down. Its suit is the trump suit. The caller cannot play that card until trump is revealed.
- PLAY: the caller leads. You must follow the led suit if you can; otherwise you may play any card.
- REVEAL: the caller may reveal the trump suit at any time. Another player who cannot follow suit may reveal on their turn, or may simply discard any card without revealing (a discard cannot win the trick while trump is hidden). A player who reveals because they cannot follow suit must then play a trump card if they have one. The hidden card returns to the caller's hand when trump is revealed. After the reveal a trump card beats every non-trump card and the highest trump wins; before the reveal the highest card of the led suit wins. When it is your turn, trump may already have been revealed by you; the legal list always shows what you may play.
- THE PILE: tricks are NOT owned by the winner. Every trick goes into a shared pile. Only after trump is revealed, when the SAME player wins two tricks in a row, that player's team takes the entire pile (1 point per trick). The winner of the 13th trick takes whatever is left in the pile.
- The game ends as soon as the bidding team has collected its bid, or can no longer reach it. If the bidding team fails it loses double its bid.

STRATEGY HINTS
- The bidding team wants to win two tricks in a row with the same player after the reveal, so it can claim the pile. The defending team wants to claim the pile first.
- Do not waste a high card when your partner is already winning the trick.
- Win a trick with the lowest card that is enough to win it. When you cannot win, throw away your lowest, least useful card.
- Count which high cards have already been played.

Answer with a single JSON object and nothing else.`

async function askModel(userMessage) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const model = process.env.GROQ_MODEL || DEFAULT_MODEL
    const body = {
      model,
      temperature: 0.3,
      // Reasoning models spend part of this budget on hidden "thinking", so keep it generous.
      max_tokens: 1024,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMessage },
      ],
    }
    // gpt-oss models are reasoning models: keep the thinking short so moves stay fast.
    if (model.startsWith('openai/gpt-oss')) body.reasoning_effort = 'low'

    const res = await fetch(GROQ_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    if (!res.ok) {
      // Include Groq's own error message so the logs say WHY it failed.
      const detail = await res.text().catch(() => '')
      throw new Error(`Groq HTTP ${res.status} (model ${model}) ${detail.slice(0, 200)}`)
    }
    const data = await res.json()
    return JSON.parse(data.choices[0].message.content)
  } finally {
    clearTimeout(timer)
  }
}

const cleanReason = (r) => (typeof r === 'string' ? r.slice(0, 160) : '')

// ---------- decision 1: the bid ----------
export async function decideBid({ hand5, seat, state, names }) {
  const b = state.bidding
  const isFirst = b.index === 0
  const current = b.current
  const allowed = BIDS.filter((x) => current === null || x > current)
  const fallback = () => rules.chooseBid({ hand5, current, isFirst })

  if (!llmEnabled()) return { bid: fallback(), source: 'rules', text: null }

  try {
    const history = b.history.length
      ? b.history.map((h) => `seat ${h.seat} (${names[h.seat]}): ${h.bid}`).join('; ')
      : 'nobody has bid yet'
    const message = [
      `You are seat ${seat} (${names[seat]}), Team ${teamLetter(seat % 2)}. Your partner is seat ${(seat + 2) % 4}.`,
      `Your first 5 cards: ${describeList(hand5)}.`,
      `Bids so far: ${history}.`,
      current === null ? 'There is no bid yet and you must bid.' : `The current bid is ${current}.`,
      `Allowed: ${allowed.join(', ')}${isFirst ? '' : ', or "pass"'}.`,
      'A higher bid scores more if you make it, but you lose DOUBLE the bid if you fail. Only bid high with a strong hand.',
      'Reply as JSON: {"reason": "<one short sentence>", "bid": <a number or "pass">}',
    ].join('\n')

    const out = await askModel(message)
    const wantsPass = out.bid === 'pass'
    const amount = Number(out.bid)
    if ((wantsPass && !isFirst) || allowed.includes(amount)) {
      return { bid: wantsPass ? 'pass' : amount, source: 'llm', text: showReasons() ? cleanReason(out.reason) : null }
    }
    console.warn('[dohatti] model returned an invalid bid:', out.bid)
  } catch (e) {
    console.warn('[dohatti] model failed to bid:', e.message)
  }
  return { bid: fallback(), source: 'rules-fallback', text: null }
}

// ---------- decision 2: which card to hide as trump ----------
export async function decideTrumpCard({ hand5, seat, state, names }) {
  const fallback = () => rules.chooseTrumpCard(hand5)

  if (!llmEnabled()) return { card: fallback(), source: 'rules', text: null }

  try {
    const message = [
      `You are seat ${seat} (${names[seat]}) and you won the bidding with a bid of ${state.bid}.`,
      `Your first 5 cards: ${describeList(hand5)}.`,
      'Choose ONE of these 5 cards to set aside face down. Its suit becomes trump, but you cannot play that card until trump is revealed.',
      `Legal choices: ${hand5.join(', ')}.`,
      'Reply as JSON: {"reason": "<one short sentence>", "card": "<one id from the legal choices>"}',
    ].join('\n')

    const out = await askModel(message)
    if (hand5.includes(out.card)) {
      return { card: out.card, source: 'llm', text: showReasons() ? cleanReason(out.reason) : null }
    }
    console.warn('[dohatti] model chose an invalid trump card:', out.card)
  } catch (e) {
    console.warn('[dohatti] model failed to choose the trump card:', e.message)
  }
  return { card: fallback(), source: 'rules-fallback', text: null }
}

// ---------- decision 3: the card to play ----------
// 1. OBSERVE
function buildPlayObservation({ state, hand, seat, knownTrump, trumpCard, legal, names }) {
  const partner = (seat + 2) % 4
  const team = seat % 2
  const lines = []

  lines.push(`You are seat ${seat} (${names[seat]}), Team ${teamLetter(team)}. Your partner is seat ${partner} (${names[partner]}).`)
  lines.push(
    `Team ${teamLetter(state.callingTeam)} (the caller was seat ${state.caller}) bid ${state.bid}. ` +
      (team === state.callingTeam
        ? 'Your team must collect that many points.'
        : `Your team wins by claiming more than ${13 - state.bid} points.`)
  )
  lines.push(
    `Claimed points: Team A ${state.points[0]}, Team B ${state.points[1]}. Unclaimed pile: ${state.pot}. Tricks played: ${state.trickCount} of 13.`
  )

  if (state.trumpRevealed) {
    lines.push(`Trump suit (public): ${SUIT_NAME[state.trump]}.`)
    if (state.lastWinner !== null && state.trick.length === 0) {
      lines.push(`Seat ${state.lastWinner} won the previous trick. If the same player wins this trick too, their team claims the whole pile.`)
    }
  } else if (knownTrump) {
    lines.push(
      `Trump suit: ${SUIT_NAME[knownTrump]}. You hid ${describe(trumpCard)} as the trump card; it is not in your hand and returns to your hand when trump is revealed. The others do not know the suit yet.`
    )
  } else {
    lines.push('Trump suit: not revealed yet, and you do not know it.')
  }

  lines.push(`Your hand: ${describeList(hand)}.`)

  if (state.trick.length === 0) {
    lines.push('You lead this trick: any card is legal.')
  } else {
    lines.push(
      'Cards in the current trick, in order: ' +
        state.trick.map((p) => `seat ${p.seat} played ${describe(p.card)}`).join('; ') +
        '.'
    )
    lines.push(`Suit led: ${SUIT_NAME[suitOf(state.trick[0].card)]}.`)
    lines.push(`Currently winning the trick: seat ${trickWinner(state.trick, knownTrump)}.`)
  }

  const played = state.played || []
  lines.push(played.length ? `All cards played so far in this game: ${played.join(', ')}.` : 'No cards have been played yet.')
  lines.push(`Legal cards you may play: ${legal.join(', ')}.`)
  lines.push('Reply as JSON: {"reason": "<one short sentence>", "card": "<one id from the legal list>"}')
  return lines.join('\n')
}

// hand = the seat's visible hand (without the hidden trump card)
export async function decidePlay({ state, hand, seat, trumpCard, names }) {
  const legal = legalPlays(state, hand, seat)
  const knownTrump = state.trumpRevealed ? state.trump : seat === state.caller && trumpCard ? suitOf(trumpCard) : null
  const fallbackCard = () => rules.choosePlay({ state, hand, seat, trumpCard })

  // Only one legal card? No need to ask anybody.
  if (legal.length === 1) return { card: legal[0], source: 'rules', text: null }

  if (!llmEnabled()) return { card: fallbackCard(), source: 'rules', text: null }

  try {
    const observation = buildPlayObservation({ state, hand, seat, knownTrump, trumpCard, legal, names }) // 1
    const out = await askModel(observation) // 2
    if (legal.includes(out.card)) {
      // 3
      console.log(`[dohatti] seat ${seat} model played ${out.card}: ${out.reason}`)
      return { card: out.card, source: 'llm', text: showReasons() ? cleanReason(out.reason) : null }
    }
    console.warn('[dohatti] model chose an illegal card:', out.card)
  } catch (e) {
    console.warn('[dohatti] model failed to play:', e.message)
  }
  return { card: fallbackCard(), source: 'rules-fallback', text: null } // 4
}
