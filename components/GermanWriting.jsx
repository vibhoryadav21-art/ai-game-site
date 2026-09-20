import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";

const LEVELS = ["A1", "A2", "B1", "B2", "C1"];

const BADGES = [
  { min: 0, name: "Beginner" },
  { min: 30, name: "Challenger" },
  { min: 60, name: "Advanced" },
  { min: 90, name: "Pro" },
  { min: 120, name: "QuizMaster" },
];

function getBadge(score) {
  let badge = BADGES[0].name;
  for (const tier of BADGES) {
    if (score >= tier.min) badge = tier.name;
  }
  return badge;
}

function shuffle(array) {
  const copy = [...array];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export default function GermanWriting({ user, stats, onStatsChange }) {
  const [practiceLevel, setPracticeLevel] = useState("all");
  const [question, setQuestion] = useState(null);
  const [loadingQuestion, setLoadingQuestion] = useState(true);
  const [answerText, setAnswerText] = useState("");
  const [grading, setGrading] = useState(false);
  const [result, setResult] = useState(null); // { correct, feedback }
  const [error, setError] = useState("");

  const fetchQuestion = useCallback(async (level, avoidId) => {
    setLoadingQuestion(true);
    let query = supabase.from("german_open_questions").select("*").eq("source_language", "en");
    if (level && level !== "all") query = query.eq("level", level);
    const { data, error } = await query;

    if (error || !data || data.length === 0) {
      console.error("Failed to load open question:", error?.message);
      setQuestion(null);
      setLoadingQuestion(false);
      return;
    }

    let pool = data;
    if (data.length > 1 && avoidId) pool = data.filter((q) => q.id !== avoidId);
    const pick = shuffle(pool)[0];
    setQuestion(pick);
    setLoadingQuestion(false);
  }, []);

  useEffect(() => {
    fetchQuestion("all", null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleLevelChange(newLevel) {
    setPracticeLevel(newLevel);
    resetUI();
    fetchQuestion(newLevel, question?.id);
  }

  function resetUI() {
    setAnswerText("");
    setResult(null);
    setError("");
  }

  async function submitAnswer() {
    if (!answerText.trim() || !question) return;
    setGrading(true);
    setError("");

    try {
      const res = await fetch("/api/ai/grade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: question.prompt,
          referenceAnswer: question.reference_answer,
          userAnswer: answerText,
          level: question.level,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");

      setResult({ correct: data.correct, feedback: data.feedback });

      // Same scoring rule as MCQ practice: +1 correct, -1 wrong, floor at 0.
      const newScore = Math.max(0, (stats.score || 0) + (data.correct ? 1 : -1));
      const totalAnswered = stats.total_answered + 1;
      const totalCorrect = stats.total_correct + (data.correct ? 1 : 0);

      onStatsChange({ ...stats, score: newScore, total_answered: totalAnswered, total_correct: totalCorrect });

      await supabase
        .from("german_stats")
        .update({
          score: newScore,
          total_answered: totalAnswered,
          total_correct: totalCorrect,
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", user.id);
    } catch (err) {
      setError("Couldn't grade that — try again.");
    } finally {
      setGrading(false);
    }
  }

  function nextQuestion() {
    resetUI();
    fetchQuestion(practiceLevel, question?.id);
  }

  if (loadingQuestion || !question) {
    return (
      <div className="flex-1 bg-black text-zinc-100 flex items-center justify-center">
        <p className="text-zinc-400">Loading question…</p>
      </div>
    );
  }

  return (
    <div className="flex-1 bg-black text-zinc-100 flex flex-col items-center justify-center gap-6 p-6">
      <div className="flex flex-wrap items-center justify-center gap-3 text-xs text-zinc-400">
        <span className="px-3 py-1 rounded-full bg-zinc-900 border border-zinc-700 text-zinc-200">
          {getBadge(stats.score || 0)} · {stats.score || 0} pts
        </span>
        <Link href="/learning/german" className="text-sky-300 hover:text-sky-200 transition">
          Back to MCQ practice
        </Link>
      </div>

      <select
        value={practiceLevel}
        onChange={(e) => handleLevelChange(e.target.value)}
        className="bg-zinc-900 border border-zinc-700 text-zinc-200 text-xs rounded-lg px-2 py-1.5 focus:outline-none focus:border-sky-400"
      >
        <option value="all">All levels</option>
        {LEVELS.map((lvl) => (
          <option key={lvl} value={lvl}>
            {lvl}
          </option>
        ))}
      </select>

      <div className="w-full max-w-md flex flex-col gap-4">
        <p className="text-lg text-center">{question.prompt}</p>

        <textarea
          value={answerText}
          onChange={(e) => setAnswerText(e.target.value)}
          disabled={!!result}
          rows={3}
          placeholder="Write your answer in German…"
          className="w-full resize-none rounded-xl bg-zinc-900 border border-zinc-700 text-zinc-100 p-3 placeholder:text-zinc-500 focus:outline-none focus:border-sky-400 disabled:opacity-60"
        />

        {!result ? (
          <button
            onClick={submitAnswer}
            disabled={!answerText.trim() || grading}
            className="bg-sky-500 hover:bg-sky-400 disabled:opacity-40 text-zinc-950 font-medium py-2 rounded-xl transition"
          >
            {grading ? "Checking…" : "Submit"}
          </button>
        ) : (
          <div className="flex flex-col gap-3">
            <div
              className={`rounded-xl p-3 border ${
                result.correct
                  ? "bg-emerald-950 border-emerald-700 text-emerald-200"
                  : "bg-rose-950 border-rose-700 text-rose-200"
              }`}
            >
              <p className="font-medium mb-1">{result.correct ? "Correct! +1 point" : "Not quite. −1 point"}</p>
              <p className="text-sm">{result.feedback}</p>
            </div>
            <p className="text-xs text-zinc-500">
              One correct way to say it: <span className="text-zinc-300">{question.reference_answer}</span>
            </p>
            <button
              onClick={nextQuestion}
              className="bg-sky-500 hover:bg-sky-400 text-zinc-950 font-medium py-2 rounded-xl transition"
            >
              Next question
            </button>
          </div>
        )}

        {error && <p className="text-xs text-rose-300">{error}</p>}
      </div>
    </div>
  );
}
