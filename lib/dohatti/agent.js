// SERVER-ONLY. The AI agent: asks a Groq-hosted language model to play a seat.
//
// How an agent works, in four steps (read decidePlay below top to bottom):
//   1. OBSERVE  - build a text description of exactly what this seat may see.
//   2. THINK    - send it to the language model with the rules and an answer format.
//   3. VALIDATE - never trust the model: the chosen card must be on the legal list.
//   4. FALLBACK - if the model fails, times out or cheats, the rule bot plays instead.
//
// The game engine stays in charge of the rules. The model only ever picks from the
// legal choices, so a confused model can never break the game.

import { SUITS, SUIT_NAME, suitOf, rankOf, legalCards, trickWinner } from './engine'
import * as rules from './ai'

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions'
const DEFAULT_MODEL = 'llama-3.3-70b-versatile' // override with GROQ_MODEL in .env
const TIMEOUT_MS = 6000
const RANK_NAME = { 11: 'Jack', 12: 'Queen', 13: 'King', 14: 'Ace' }

// Use the language model only when a key exists and DOHATTI_AI_MODE is not "rules".
const llmEnabled = () => !!process.env.GROQ_API_KEY && process.env.DOHATTI_AI_MODE !== 'rules'
// Set DOHATTI_SHOW_AI_REASONS=true to show the model's one-line reasoning to everyone at
// the table. Leave it off in real games: the reasoning can mention the bot's own cards.
const showReasons = () => process.env.DOHATTI_SHOW_AI_REASONS === 'true'

const describe = (card) => `${RANK_NAME[rankOf(card)] || rankOf(card)} of ${SUIT_NAME[suitOf(card)]} (${card})`
const describeList = (cards) => cards.map(describe).join(', ')

const SYSTEM_PROMPT = `You are an expert player of Court Piece (hidden trump), a 4-player trick-taking card game, controlling ONE seat.

RULES
- 52 cards, 13 per player. Seats 0,1,2,3 play in that order, then back to 0. Partners sit opposite: seats 0 and 2 are Team A, seats 1 and 3 are Team B.
- Ranks from high to low: Ace, King, Queen, Jack, 10 down to 2.
- You must follow the suit that was led if you have it. If you have none of that suit you may play any card.
- One suit is TRUMP. A trump card beats every non-trump card; the highest trump wins. If no trump is played, the highest card of the led suit wins. The winner of a trick leads the next one.
- The trump suit is hidden at first. It becomes public the first time a player cannot follow suit.
- A team wins the game by taking 7 or more of the 13 tricks.

STRATEGY HINTS
- Do not waste a high card when your partner is already winning the trick.
- Win a trick with the lowest card that is enough to win it.
- When you cannot win, throw away your lowest, least useful card.
- Count which high cards have already been played.

Answer with a single JSON object and nothing else.`

async function askModel(userMessage) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(GROQ_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: process.env.GROQ_MODEL || DEFAULT_MODEL,
        temperature: 0.3,
        max_tokens: 200,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userMessage },
        ],
      }),
      signal: controller.signal,
    })
    if (!res.ok) throw new Error(`Groq HTTP ${res.status}`)
    const data = await res.json()
    return JSON.parse(data.choices[0].message.content)
  } finally {
    clearTimeout(timer)
  }
}

const cleanReason = (r) => (typeof r === 'string' ? r.slice(0, 160) : '')

// ---------- 1. OBSERVE ----------
function buildPlayObservation({ state, hand, seat, knownTrump, legal, names }) {
  const partner = (seat + 2) % 4
  const team = seat % 2 === 0 ? 'A' : 'B'
  const lines = []

  lines.push(`You are seat ${seat} (${names[seat]}), Team ${team}. Your partner is seat ${partner} (${names[partner]}).`)
  lines.push(
    `Tricks won so far: Team A ${state.tricksWon[0]}, Team B ${state.tricksWon[1]} (${state.trickCount} of 13 tricks played).`
  )

  if (state.trumpRevealed) {
    lines.push(`Trump suit (public): ${SUIT_NAME[state.trump]}.`)
  } else if (knownTrump) {
    lines.push(
      `Trump suit: ${SUIT_NAME[knownTrump]}. Only you know this; it stays hidden until someone cannot follow suit.`
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
  lines.push(
    played.length
      ? `All cards played so far in this game: ${played.join(', ')}.`
      : 'No cards have been played yet.'
  )

  lines.push(`Legal cards you may play: ${legal.join(', ')}.`)
  lines.push('Reply as JSON: {"reason": "<one short sentence>", "card": "<one id from the legal list>"}')
  return lines.join('\n')
}

// ---------- the agent's two decisions ----------
export async function decideTrump({ firstFive, seat, names }) {
  const fallbackSuit = () => rules.chooseTrump(firstFive)

  if (!llmEnabled()) return { suit: fallbackSuit(), source: 'rules', text: null }

  try {
    const message = [
      `You are seat ${seat} (${names[seat]}) and you are the trump caller.`,
      `Your first 5 cards: ${describeList(firstFive)}.`,
      'Choose the trump suit. Suits: S = Spades, H = Hearts, D = Diamonds, C = Clubs.',
      'Reply as JSON: {"reason": "<one short sentence>", "suit": "<S, H, D or C>"}',
    ].join('\n')

    const out = await askModel(message)
    if (SUITS.includes(out.suit)) {
      return { suit: out.suit, source: 'llm', text: showReasons() ? cleanReason(out.reason) : null }
    }
    console.warn('[dohatti] model returned an invalid suit:', out.suit)
  } catch (e) {
    console.warn('[dohatti] model failed to choose trump:', e.message)
  }
  return { suit: fallbackSuit(), source: 'rules-fallback', text: null }
}

export async function decidePlay({ state, hand, seat, secretTrump, names }) {
  const legal = legalCards(hand, state.trick)
  const knownTrump = state.trumpRevealed ? state.trump : seat === state.caller ? secretTrump : null
  const fallbackCard = () => rules.choosePlay({ state, hand, seat, secretTrump })

  // Only one legal card? No need to ask anybody.
  if (legal.length === 1) return { card: legal[0], source: 'rules', text: null }

  if (!llmEnabled()) return { card: fallbackCard(), source: 'rules', text: null }

  try {
    const observation = buildPlayObservation({ state, hand, seat, knownTrump, legal, names }) // 1
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
