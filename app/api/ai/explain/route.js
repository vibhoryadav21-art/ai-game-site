import { createClient } from '@supabase/supabase-js'

const ALLOWED_TABLES = ['german_questions', 'trivia_questions']
const LANGUAGE_NAMES = { en: 'English', de: 'German', ar: 'Arabic', ru: 'Russian' }

export async function POST(request) {
  const { table, questionId, question, options, correctOption, userOption, language } =
    await request.json()

  if (!ALLOWED_TABLES.includes(table)) {
    return Response.json({ error: 'Invalid table' }, { status: 400 })
  }

  const targetLanguage = LANGUAGE_NAMES[language] || 'English'

  const prompt = `A student answered this multiple-choice question incorrectly. In 2-3 short sentences, explain why the correct answer is right and why their answer was wrong. Write the explanation in ${targetLanguage}. Be encouraging, and focus on the specific knowledge point being tested.

Question: ${question}
a) ${options.a}
b) ${options.b}
c) ${options.c}
d) ${options.d}

Correct answer: ${correctOption}) ${options[correctOption]}
Student's answer: ${userOption ? `${userOption}) ${options[userOption]}` : '(skipped)'}`

  const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'openai/gpt-oss-120b',
      messages: [{ role: 'user', content: prompt }],
    }),
  })

  const groqData = await groqRes.json()

  if (!groqRes.ok) {
    return Response.json(
      { error: groqData.error?.message || 'AI request failed' },
      { status: 500 }
    )
  }

  const explanation = groqData.choices[0].message.content.trim()

  // Cache it on the question itself, keyed by language, using the
  // privileged service-role key — this is server-only code, never exposed
  // to the browser, so it's safe to bypass RLS here.
  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )

  const { data: existing } = await supabaseAdmin
    .from(table)
    .select('explanations')
    .eq('id', questionId)
    .single()

  const updatedExplanations = { ...(existing?.explanations || {}), [language]: explanation }

  await supabaseAdmin.from(table).update({ explanations: updatedExplanations }).eq('id', questionId)

  return Response.json({ explanation })
}
