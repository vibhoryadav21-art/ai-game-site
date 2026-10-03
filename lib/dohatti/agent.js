// SERVER-ONLY. The AI agent: asks a Groq-hosted language model to play a seat.
//
// How an agent works, in four steps (read decidePlay below top to bottom):
//   1. OBSERVE  - build a text description of exactly what this seat may see.
//   2. THINK    - send it to the language model with the rules and an answer format.
//   3. VALIDATE - never trust the model: its choice must be on the legal list.
//   4. RETRY / FALLBACK - ask again a couple of times if the call failed; if it still
//      fails, the rule bot plays instead and the failure is recorded.
//
// The game engine stays in charge of the rules. The model only ever picks from the
// legal choices, so a confused model can never break the game.
//
// Every decision returns { <choice>, source, meta }. `meta` is what gets written to the
// dohatti_ai_log table, so the data can be analysed later.
//   source: 'llm' (model decided) | 'rules' (model switched off) |
//           'forced' (only one legal move) | 'rules-fallback' (model failed)

import { SUITS, SUIT_NAME, BIDS, suitOf, rankOf, legalPlays, trickWinner } from './engine'
import * as rules from './ai'

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions'
// Groq retires models over time, so check console.groq.com/docs/models if you get HTTP 404.
// Override with GROQ_MODEL in .env (e.g. openai/gpt-oss-20b is faster and cheaper).
const DEFAULT_MODEL = 'openai/gpt-oss-120b'
const MAX_ATTEMPTS = 3 // first try + up to 2 retries
const ATTEMPT_TIMEOUT_MS = 6000
const TOTAL_BUDGET_MS = 14000 // never keep a player waiting longer than this for one decision
const MAX_WAIT_FOR_RATE_LIMIT_MS = 2500 // if Groq says "wait longer than this", give up and fall back
const RETRY_BASE_MS = Number(process.env.DOHATTI_RETRY_BASE_MS ?? 400)
const RANK_NAME = { 11: 'Jack', 12: 'Queen', 13: 'King', 14: 'Ace' }
const TEMPERATURE = { secure: 0.2, normal: 0.35, aggressive: 0.6 }

const modelName = () => process.env.GROQ_MODEL || DEFAULT_MODEL
// Use the language model only when a key exists and DOHATTI_AI_MODE is not "rules".
const llmEnabled = () => !!process.env.GROQ_API_KEY && process.env.DOHATTI_AI_MODE !== 'rules'

const describe = (card) => `${RANK_NAME[rankOf(card)] || rankOf(card)} of ${SUIT_NAME[suitOf(card)]} (${card})`
const describeList = (cards) => cards.map(describe).join(', ')
const teamLetter = (team) => (team === 0 ? 'A' : 'B')
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const cleanReason = (r) => (typeof r === 'string' ? r.slice(0, 200) : null)

const STYLE_TEXT = {
  secure:
    'PLAY STYLE: SECURE. Avoid risk. Bid only with a clearly strong hand, pass when unsure, and do not bid 13 unless you hold almost all the high cards. Prefer safe plays that do not hand the other team a chance to claim the pile.',
  normal: 'PLAY STYLE: NORMAL. Balance risk and reward.',
  aggressive:
    'PLAY STYLE: AGGRESSIVE. Take risks for bigger rewards: bid higher with decent hands and play boldly to win tricks.',
}

const SYSTEM_BASE = `You are an expert player of Do Hatti, a 4-player partnership trick-taking card game with bidding and a hidden trump. You control ONE seat.

RULES
- 52 cards, 13 per player. Seats 0,1,2,3 play in that order, then back to 0. Partners sit opposite: seats 0 and 2 are Team A, seats 1 and 3 are Team B. Ranks high to low: Ace, King, Queen, Jack, 10 down to 2.
- BIDDING: each player sees only their first 5 cards and gets one turn to bid 10, 11 or 13 (the number of the 13 tricks their team promises to collect) or pass. A bid must beat the current bid. The highest bidder is the caller.
- TRUMP: the caller sets ONE of their first 5 cards aside, face down. Its suit is the trump suit. The caller cannot play that card until trump is revealed.
- PLAY: the caller leads. You must follow the led suit if you can; otherwise you may play any card.
- REVEAL: the caller may reveal the trump suit at any time. Another player who cannot follow suit may reveal on their turn, or may simply discard any card without revealing (a discard cannot win the trick while trump is hidden). A player who reveals because they cannot follow suit must then play a trump card if they have one. The hidden card returns to the caller's hand when trump is revealed. After the reveal a trump card beats every non-trump card and the highest trump wins; before the reveal the highest card of the led suit wins. The legal list you are given always shows what you may play.
- THE PILE: tricks are NOT owned by the winner. Every trick goes into a shared pile. Only after trump is revealed, when the SAME player wins two tricks in a row, that player's team takes the entire pile (1 point per trick). The winner of the 13th trick takes whatever is left in the pile.
- The game ends as soon as the bidding team has collected its bid, or can no longer reach it. If the bidding team fails it loses double its bid.

STRATEGY HINTS
- The bidding team wants to win two tricks in a row with the same player after the reveal, so it can claim the pile. The defending team wants to claim the pile first.
- Do not waste a high card when your partner is already winning the trick.
- Win a trick with the lowest card that is enough to win it. When you cannot win, throw away your lowest, least useful card.
- Count which high cards have already been played.`

const systemPrompt = (risk) =>
  `${SYSTEM_BASE}\n\n${STYLE_TEXT[risk] || STYLE_TEXT.normal}\n\nAnswer with a single JSON object and nothing else.`

// ------------------------------------------------------------------------------------
// One call to Groq. Throws an Error with { kind, retryable, retryAfterMs, status }.
// ------------------------------------------------------------------------------------
function groqError(message, kind, retryable, extra = {}) {
  return Object.assign(new Error(message), { kind, retryable, ...extra })
}

async function callGroq({ system, user, temperature, timeoutMs }) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const model = modelName()
  try {
    const body = {
      model,
      temperature,
      // Reasoning models spend part of this budget on hidden "thinking", so keep it generous.
      max_tokens: 1024,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }
    // gpt-oss models are reasoning models: keep the thinking short so moves stay fast.
    if (model.startsWith('openai/gpt-oss')) body.reasoning_effort = 'low'

    let res
    try {
      res = await fetch(GROQ_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
    } catch (e) {
      if (e?.name === 'AbortError') throw groqError('Groq did not answer in time', 'timeout', true)
      throw groqError(`Network error: ${e?.message || e}`, 'network', true)
    }

    if (!res.ok) {
      const detail = (await res.text().catch(() => '')).slice(0, 200)
      const seconds = Number(res.headers?.get?.('retry-after'))
      const retryAfterMs = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : null
      const message = `Groq HTTP ${res.status} (model ${model}) ${detail}`
      if (res.status === 429) throw groqError(message, 'rate_limit', true, { status: 429, retryAfterMs })
      if (res.status >= 500) throw groqError(message, 'http_5xx', true, { status: res.status })
      throw groqError(message, 'http_4xx', false, { status: res.status }) // wrong key, model, request: retrying will not help
    }

    const data = await res.json()
    const content = data?.choices?.[0]?.message?.content
    let json
    try {
      json = JSON.parse(content)
    } catch {
      throw groqError('The model did not return valid JSON', 'bad_json', true)
    }
    return { json, usage: data?.usage || {}, model }
  } finally {
    clearTimeout(timer)
  }
}

// Asks the model, validates the answer, retries when it makes sense.
// validate(json) -> { ok: true, value } | { ok: false, detail }
async function askWithRetry({ user, risk, validate }) {
  const started = Date.now()
  const stats = { attempts: 0, errorKind: null, errorDetail: null, tokensIn: null, tokensOut: null }
  let message = user

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const elapsed = Date.now() - started
    const remaining = TOTAL_BUDGET_MS - elapsed
    if (remaining < 1500) break
    stats.attempts = attempt

    try {
      const { json, usage, model } = await callGroq({
        system: systemPrompt(risk),
        user: message,
        temperature: TEMPERATURE[risk] ?? TEMPERATURE.normal,
        timeoutMs: Math.min(ATTEMPT_TIMEOUT_MS, remaining),
      })
      stats.tokensIn = (stats.tokensIn || 0) + (usage.prompt_tokens || 0)
      stats.tokensOut = (stats.tokensOut || 0) + (usage.completion_tokens || 0)

      const verdict = validate(json)
      if (verdict.ok) {
        return { ok: true, value: verdict.value, reason: cleanReason(json.reason), model, latencyMs: Date.now() - started, ...stats, errorKind: null, errorDetail: null }
      }
      // The model answered, but with something we cannot use: tell it and ask again.
      stats.errorKind = 'illegal'
      stats.errorDetail = verdict.detail
      message = `${user}\n\nYour previous answer was not valid (${verdict.detail}). Answer again and use ONLY the allowed values.`
    } catch (e) {
      stats.errorKind = e.kind || 'network'
      stats.errorDetail = String(e.message || e).slice(0, 300)
      if (!e.retryable) break
      if (e.retryAfterMs && e.retryAfterMs > MAX_WAIT_FOR_RATE_LIMIT_MS) break
      if (attempt < MAX_ATTEMPTS) await sleep(e.retryAfterMs ?? RETRY_BASE_MS * attempt)
    }
  }
  return { ok: false, model: modelName(), latencyMs: Date.now() - started, ...stats }
}

// Builds the object that is returned to the game and logged.
function result(choiceKey, choice, source, meta) {
  return {
    [choiceKey]: choice,
    source,
    meta: { source, ok: source !== 'rules-fallback', attempts: 0, ...meta },
  }
}

// ---------- decision 1: the bid ----------
export async function decideBid({ hand5, seat, state, names, risk = 'normal' }) {
  const b = state.bidding
  const isFirst = b.index === 0
  const current = b.current
  const allowed = BIDS.filter((x) => current === null || x > current)
  const legal = [...allowed.map(String), ...(isFirst ? [] : ['pass'])]
  const fallback = () => rules.chooseBid({ hand5, current, isFirst, risk })

  if (!llmEnabled()) return result('bid', fallback(), 'rules', { legal })

  const history = b.history.length
    ? b.history.map((h) => `seat ${h.seat} (${names[h.seat]}): ${h.bid}`).join('; ')
    : 'nobody has bid yet'
  const user = [
    `You are seat ${seat} (${names[seat]}), Team ${teamLetter(seat % 2)}. Your partner is seat ${(seat + 2) % 4}.`,
    `Your first 5 cards: ${describeList(hand5)}.`,
    `Bids so far: ${history}.`,
    current === null ? 'There is no bid yet and you must bid.' : `The current bid is ${current}.`,
    `Allowed: ${allowed.join(', ')}${isFirst ? '' : ', or "pass"'}.`,
    'A higher bid scores more if you make it, but you lose DOUBLE the bid if you fail. Only bid high with a strong hand.',
    'Reply as JSON: {"reason": "<one short sentence>", "bid": <a number or "pass">}',
  ].join('\n')

  const answer = await askWithRetry({
    user,
    risk,
    validate: (json) => {
      if (json.bid === 'pass' && !isFirst) return { ok: true, value: 'pass' }
      const amount = Number(json.bid)
      if (allowed.includes(amount)) return { ok: true, value: amount }
      return { ok: false, detail: `${JSON.stringify(json.bid)} is not allowed; allowed: ${legal.join(', ')}` }
    },
  })

  if (answer.ok) return result('bid', answer.value, 'llm', { legal, ...pick(answer) })
  return result('bid', fallback(), 'rules-fallback', { legal, ...pick(answer) })
}

// ---------- decision 2: which card to hide as trump ----------
export async function decideTrumpCard({ hand5, seat, state, names, risk = 'normal' }) {
  const fallback = () => rules.chooseTrumpCard(hand5)
  if (!llmEnabled()) return result('card', fallback(), 'rules', { legal: hand5 })

  const user = [
    `You are seat ${seat} (${names[seat]}) and you won the bidding with a bid of ${state.bid}.`,
    `Your first 5 cards: ${describeList(hand5)}.`,
    'Choose ONE of these 5 cards to set aside face down. Its suit becomes trump, but you cannot play that card until trump is revealed.',
    `Legal choices: ${hand5.join(', ')}.`,
    'Reply as JSON: {"reason": "<one short sentence>", "card": "<one id from the legal choices>"}',
  ].join('\n')

  const answer = await askWithRetry({
    user,
    risk,
    validate: (json) =>
      hand5.includes(json.card)
        ? { ok: true, value: json.card }
        : { ok: false, detail: `${JSON.stringify(json.card)} is not one of: ${hand5.join(', ')}` },
  })

  if (answer.ok) return result('card', answer.value, 'llm', { legal: hand5, ...pick(answer) })
  return result('card', fallback(), 'rules-fallback', { legal: hand5, ...pick(answer) })
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
export async function decidePlay({ state, hand, seat, trumpCard, names, risk = 'normal' }) {
  const legal = legalPlays(state, hand, seat)
  const knownTrump = state.trumpRevealed ? state.trump : seat === state.caller && trumpCard ? suitOf(trumpCard) : null
  const fallbackCard = () => rules.choosePlay({ state, hand, seat, trumpCard })

  // Only one legal card? Nobody needs to be asked: it is an automatic move.
  if (legal.length === 1) return result('card', legal[0], 'forced', { legal })

  if (!llmEnabled()) return result('card', fallbackCard(), 'rules', { legal })

  const user = buildPlayObservation({ state, hand, seat, knownTrump, trumpCard, legal, names }) // 1
  const answer = await askWithRetry({
    // 2 + 3 + 4
    user,
    risk,
    validate: (json) =>
      legal.includes(json.card)
        ? { ok: true, value: json.card }
        : { ok: false, detail: `${JSON.stringify(json.card)} is not one of: ${legal.join(', ')}` },
  })

  if (answer.ok) {
    console.log(`[dohatti] seat ${seat} model played ${answer.value} (attempt ${answer.attempts}): ${answer.reason}`)
    return result('card', answer.value, 'llm', { legal, ...pick(answer) })
  }
  console.warn(`[dohatti] seat ${seat} model failed after ${answer.attempts} attempt(s): ${answer.errorKind}: ${answer.errorDetail}`)
  return result('card', fallbackCard(), 'rules-fallback', { legal, ...pick(answer) })
}

function pick(a) {
  return {
    attempts: a.attempts,
    errorKind: a.errorKind ?? null,
    errorDetail: a.errorDetail ?? null,
    latencyMs: a.latencyMs ?? null,
    tokensIn: a.tokensIn ?? null,
    tokensOut: a.tokensOut ?? null,
    model: a.model ?? null,
    reason: a.reason ?? null,
  }
}
