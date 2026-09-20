export async function POST(request) {
  const { prompt, referenceAnswer, userAnswer, level } = await request.json()

  if (!userAnswer || !userAnswer.trim()) {
    return Response.json({ error: 'No answer provided' }, { status: 400 })
  }

  const gradingPrompt = `You are grading a German language learner's written answer at CEFR level ${level}.

Task given to the student: ${prompt}
One example of a correct answer: ${referenceAnswer}
Student's answer: ${userAnswer}

Judge whether the student's answer correctly accomplishes the task. Accept reasonable variation — different word order, synonyms, or phrasing are fine as long as the German is grammatically correct and conveys the same meaning as the task required. Minor typos or missing capitalization should not cause a fail on their own, but real grammar or meaning errors should.

Respond with ONLY a JSON object, no other text, no markdown code fences, in exactly this shape:
{"correct": true or false, "feedback": "1-2 short sentences explaining the verdict, in English, encouraging in tone"}`

  const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'qwen/qwen3.8-27b',
      messages: [{ role: 'user', content: gradingPrompt }],
      response_format: { type: 'json_object' },
    }),
  })

  const groqData = await groqRes.json()

  if (!groqRes.ok) {
    return Response.json(
      { error: groqData.error?.message || 'AI request failed' },
      { status: 500 }
    )
  }

  let parsed
  try {
    parsed = JSON.parse(groqData.choices[0].message.content)
  } catch (e) {
    return Response.json({ error: 'AI returned an unexpected format — try again' }, { status: 500 })
  }

  if (typeof parsed.correct !== 'boolean') {
    return Response.json({ error: 'AI returned an unexpected format — try again' }, { status: 500 })
  }

  return Response.json({ correct: parsed.correct, feedback: parsed.feedback || '' })
}
