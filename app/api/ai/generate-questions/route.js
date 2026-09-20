import { createClient } from '@supabase/supabase-js'

const GERMAN_LEVEL_FOCUS = {
  A1: 'basic present tense, articles (der/die/das), simple pronouns, numbers, everyday vocabulary',
  A2: 'perfect tense, modal verbs, comparatives, separable verbs, basic dative case',
  B1: 'subjunctive II (würde/hätte), passive voice, relative clauses, genitive case, subordinate connectors',
  B2: 'subjunctive I (reported speech), passive with modal verbs, extended participle constructions, formal connectors',
  C1: 'idiomatic verb-preposition pairings, unreal past subjunctive, advanced formal connectors, nuanced case usage, sophisticated collocations',
}

const TRIVIA_LEVEL_FOCUS = {
  Easy: 'well-known facts across science, geography, history, sports, and entertainment that most people would know',
  Medium: 'moderately challenging facts requiring some specific knowledge across science, geography, history, sports, and entertainment',
  Hard: 'advanced or specialized facts requiring deep, specific knowledge across science, geography, history, sports, and entertainment',
}

const LANGUAGE_NAMES = { en: 'English', de: 'German', ar: 'Arabic', ru: 'Russian' }

export async function POST(request) {
  const { table, level, topic, count = 5, language = 'en' } = await request.json()

  if (!['german_questions', 'trivia_questions'].includes(table)) {
    return Response.json({ error: 'Invalid table' }, { status: 400 })
  }

  const isGerman = table === 'german_questions'
  const focus = (isGerman ? GERMAN_LEVEL_FOCUS : TRIVIA_LEVEL_FOCUS)[level]
  if (!focus) {
    return Response.json({ error: 'Invalid level' }, { status: 400 })
  }

  const topicLine = topic ? `Focus specifically on the topic "${topic}".` : ''
  const languageLine = isGerman ? '' : `Write the questions in ${LANGUAGE_NAMES[language] || 'English'}.`

  const prompt = `Generate ${count} ${isGerman ? 'German language-learning' : 'trivia'} multiple-choice questions at ${isGerman ? 'CEFR level' : 'difficulty'} ${level}.
Focus on: ${focus}. ${topicLine} ${languageLine}

Respond with ONLY a JSON object, no other text, no markdown code fences, in exactly this shape:
{"questions": [
  {"question": "...", "option_a": "...", "option_b": "...", "option_c": "...", "option_d": "...", "correct_option": "a", "topic": "..."}
]}

Rules:
- Use ___ for the blank in "question" where relevant.
- CRITICAL: every question must have exactly ONE defensibly correct answer, uniquely determined by the sentence itself — not just grammatically possible, but the only sensible answer given the full context. Before finalizing each question, check: could a careful learner reasonably defend a different option using only the sentence given? If yes, rewrite it.
- For vocabulary topics (numbers, colors, days, objects, etc.), never write a fill-in-the-blank sentence where several vocabulary words could fit equally well — for example "Er sitzt auf Platz ___" fits any number and has no single correct answer. Instead, either (a) reference a specific fact the learner must know ("Wie viele Tage hat eine Woche?"), (b) use a math or logic clue ("Fünf plus drei ist ___"), or (c) ask for a direct translation ("Wie sagt man 'seven' auf Deutsch?").
- Exactly one option is correct; correct_option is "a", "b", "c", or "d".
- Distractors must be plausible but clearly wrong to a careful learner at this level.
- Vary the sentence patterns and topics — don't repeat the same structure more than twice.
- Every question must be factually/grammatically correct.`

  const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'qwen/qwen3.8-27b',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      max_tokens: 900,
    }),
  })

  const groqData = await groqRes.json()

  if (!groqRes.ok) {
    return Response.json({ error: groqData.error?.message || 'AI request failed' }, { status: 500 })
  }

  let parsed
  try {
    parsed = JSON.parse(groqData.choices[0].message.content)
  } catch (e) {
    return Response.json({ error: 'AI returned an unexpected format — try again' }, { status: 500 })
  }

  const questions = parsed.questions || []
  if (questions.length === 0) {
    return Response.json({ error: 'No questions were generated — try again' }, { status: 500 })
  }

  const rows = questions.map((q) => ({
    level,
    question: q.question,
    option_a: q.option_a,
    option_b: q.option_b,
    option_c: q.option_c,
    option_d: q.option_d,
    correct_option: q.correct_option,
    topic: q.topic || topic || null,
    ...(isGerman ? {} : { language }),
  }))

  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )

  const { error: insertError } = await supabaseAdmin.from(table).insert(rows)

  if (insertError) {
    return Response.json({ error: insertError.message }, { status: 500 })
  }

  return Response.json({ insertedCount: rows.length })
}
