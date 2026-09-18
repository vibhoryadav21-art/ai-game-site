import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabaseClient";

const LEVELS = ["A1", "A2", "B1", "B2", "C1"];
const QUESTIONS_PER_LEVEL = 4; // 5 levels × 4 = 20

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

export default function GermanPlacementTest({ user, onComplete }) {
  const [phase, setPhase] = useState("loading"); // loading -> test -> result
  const [questions, setQuestions] = useState([]);
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState([]);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    async function buildTest() {
      const picked = [];
      for (const level of LEVELS) {
        const { data, error } = await supabase
          .from("german_questions")
          .select("*")
          .eq("level", level);

        if (error) {
          setError("Couldn't load questions — check your connection and try again.");
          return;
        }
        if (!data || data.length < QUESTIONS_PER_LEVEL) {
          setError(`Not enough ${level} questions in the question bank yet.`);
          return;
        }
        picked.push(...shuffle(data).slice(0, QUESTIONS_PER_LEVEL));
      }
      setQuestions(picked);
      setPhase("test");
    }
    buildTest();
  }, []);

  function handleAnswer(selected) {
    const q = questions[index];
    const correct = selected === q.correct_option;
    const newAnswers = [...answers, { level: q.level, correct }];
    setAnswers(newAnswers);

    if (index + 1 < questions.length) {
      setIndex(index + 1);
    } else {
      finishTest(newAnswers);
    }
  }

  async function finishTest(finalAnswers) {
    const levelStats = {};
    for (const level of LEVELS) levelStats[level] = { correct: 0, total: 0 };
    finalAnswers.forEach((a) => {
      levelStats[a.level].total += 1;
      if (a.correct) levelStats[a.level].correct += 1;
    });

    // Work up through the levels in order — you're placed at the highest
    // one where you got at least half right, stopping at the first miss.
    let determinedLevel = "A1";
    for (const level of LEVELS) {
      const { correct, total } = levelStats[level];
      if (total > 0 && correct / total >= 0.5) {
        determinedLevel = level;
      } else {
        break;
      }
    }

    const totalCorrect = finalAnswers.filter((a) => a.correct).length;
    const totalWrong = finalAnswers.length - totalCorrect;
    // Same scoring rule as regular practice: +1 correct, -1 wrong, floor at 0.
    // Note this alone won't get anyone past "Beginner" — the CEFR level
    // above is the real placement result; the badge is just a bonus.
    const finalScore = Math.max(0, totalCorrect - totalWrong);

    const { error } = await supabase
      .from("german_stats")
      .update({
        current_level: determinedLevel,
        score: finalScore,
        placement_completed: true,
        total_answered: finalAnswers.length,
        total_correct: totalCorrect,
        level_stats: levelStats,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", user.id);

    if (error) {
      setError("Couldn't save your result — check your connection and try again.");
      return;
    }

    setResult({
      determinedLevel,
      finalScore,
      levelStats,
      totalCorrect,
      totalQuestions: finalAnswers.length,
    });
    setPhase("result");
  }

  if (error) {
    return (
      <div className="flex-1 bg-zinc-950 text-zinc-100 flex items-center justify-center p-6">
        <p className="text-rose-300 text-center max-w-sm">{error}</p>
      </div>
    );
  }

  if (phase === "loading") {
    return (
      <div className="flex-1 bg-zinc-950 text-zinc-100 flex items-center justify-center">
        <p className="text-zinc-400">Preparing your placement test…</p>
      </div>
    );
  }

  if (phase === "result") {
    return (
      <div className="flex-1 bg-zinc-950 text-zinc-100 flex flex-col items-center justify-center gap-6 p-6">
        <p className="text-zinc-400 text-sm uppercase tracking-wide">Placement complete</p>
        <p className="font-serif text-5xl text-sky-300">{result.determinedLevel}</p>
        <p className="text-zinc-400">
          {result.totalCorrect}/{result.totalQuestions} correct — starting badge: {getBadge(result.finalScore)} (
          {result.finalScore} pts)
        </p>
        <div className="grid grid-cols-5 gap-3 text-center text-xs">
          {LEVELS.map((level) => (
            <div key={level} className="flex flex-col gap-1">
              <span className="text-zinc-500">{level}</span>
              <span className="text-zinc-200">
                {result.levelStats[level].correct}/{result.levelStats[level].total}
              </span>
            </div>
          ))}
        </div>
        <button
          onClick={() => onComplete(result)}
          className="mt-4 bg-sky-500 hover:bg-sky-400 text-zinc-950 font-medium px-6 py-3 rounded-xl transition"
        >
          Continue
        </button>
      </div>
    );
  }

  const q = questions[index];
  const options = [
    { key: "a", text: q.option_a },
    { key: "b", text: q.option_b },
    { key: "c", text: q.option_c },
    { key: "d", text: q.option_d },
  ];

  return (
    <div className="flex-1 bg-zinc-950 text-zinc-100 flex flex-col items-center justify-center gap-8 p-6">
      <p className="text-zinc-500 text-xs uppercase tracking-wide">
        Question {index + 1} of {questions.length}
      </p>
      <p className="text-xl text-center max-w-md">{q.question}</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full max-w-md">
        {options.map((opt) => (
          <button
            key={opt.key}
            onClick={() => handleAnswer(opt.key)}
            className="bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-left transition"
          >
            {opt.text}
          </button>
        ))}
      </div>
    </div>
  );
}
