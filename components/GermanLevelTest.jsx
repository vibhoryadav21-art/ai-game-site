import { useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useLanguage } from "@/context/LanguageContext";

const LEVELS = ["A1", "A2", "B1", "B2", "C1"];
const TEST_LENGTH = 30;
const PASS_RATIO = 22 / 30; // ~73%

function shuffle(array) {
  const copy = [...array];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export default function GermanLevelTest({ user, stats, onPassed }) {
  const { t } = useLanguage();
  const tt = t.levelTest;
  const [phase, setPhase] = useState("choose"); // choose -> test -> result
  const [chosenLevel, setChosenLevel] = useState("A1");
  const [questions, setQuestions] = useState([]);
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState([]);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  async function startTest() {
    setError("");
    const { data, error } = await supabase
      .from("german_questions")
      .select("*")
      .eq("level", chosenLevel);

    if (error || !data || data.length === 0) {
      setError(tt.noQuestions);
      return;
    }

    const picked = shuffle(data).slice(0, Math.min(TEST_LENGTH, data.length));
    setQuestions(picked);
    setIndex(0);
    setAnswers([]);
    setPhase("test");
  }

  function handleAnswer(selected) {
    const q = questions[index];
    const correct = selected === q.correct_option;
    const newAnswers = [...answers, correct];
    setAnswers(newAnswers);

    if (index + 1 < questions.length) {
      setIndex(index + 1);
    } else {
      finishTest(newAnswers);
    }
  }

  async function finishTest(finalAnswers) {
    const totalCorrect = finalAnswers.filter(Boolean).length;
    const totalWrong = finalAnswers.length - totalCorrect;
    // Scales the 22/30 pass bar to however many questions were actually
    // available, in case the bank has fewer than 30 for this level.
    const passThreshold = Math.ceil(finalAnswers.length * PASS_RATIO);
    const passed = totalCorrect >= passThreshold;

    const levelStats = { ...stats.level_stats };
    const prev = levelStats[chosenLevel] || { correct: 0, total: 0 };
    levelStats[chosenLevel] = {
      correct: prev.correct + totalCorrect,
      total: prev.total + finalAnswers.length,
    };

    // These questions count toward your badge just like normal practice —
    // only current_level is conditional on passing.
    const newScore = Math.max(0, (stats.score || 0) + totalCorrect - totalWrong);
    const updates = {
      score: newScore,
      total_answered: stats.total_answered + finalAnswers.length,
      total_correct: stats.total_correct + totalCorrect,
      level_stats: levelStats,
      updated_at: new Date().toISOString(),
    };
    if (passed) updates.current_level = chosenLevel;

    const { error } = await supabase.from("german_stats").update(updates).eq("user_id", user.id);

    if (error) {
      setError(tt.saveError);
      return;
    }

    setResult({
      passed,
      totalCorrect,
      totalQuestions: finalAnswers.length,
      passThreshold,
      newScore,
    });
    setPhase("result");

    if (passed) onPassed({ ...updates });
  }

  if (phase === "choose") {
    return (
      <div className="flex-1 bg-black text-zinc-100 flex flex-col items-center justify-center gap-6 p-6">
        <h1 className="font-serif text-2xl text-sky-300">{tt.title}</h1>
        <p className="text-zinc-400 text-sm text-center max-w-sm">
          {tt.description(TEST_LENGTH, Math.ceil(TEST_LENGTH * PASS_RATIO))}
        </p>
        <select
          value={chosenLevel}
          onChange={(e) => setChosenLevel(e.target.value)}
          className="bg-zinc-900 border border-zinc-700 text-zinc-100 rounded-lg px-4 py-2 focus:outline-none focus:border-sky-400"
        >
          {LEVELS.map((lvl) => (
            <option key={lvl} value={lvl}>
              {lvl}
            </option>
          ))}
        </select>
        {error && <p className="text-rose-300 text-sm">{error}</p>}
        <button
          onClick={startTest}
          className="bg-sky-500 hover:bg-sky-400 text-zinc-950 font-medium px-6 py-3 rounded-xl transition"
        >
          {tt.startTest}
        </button>
      </div>
    );
  }

  if (phase === "result") {
    return (
      <div className="flex-1 bg-black text-zinc-100 flex flex-col items-center justify-center gap-6 p-6">
        <p className={`font-serif text-4xl ${result.passed ? "text-emerald-300" : "text-rose-300"}`}>
          {result.passed ? tt.passed : tt.notPassed}
        </p>
        <p className="text-zinc-400 text-center">
          {tt.resultSummary(result.totalCorrect, result.totalQuestions, result.passThreshold)}
        </p>
        {result.passed ? (
          <p className="text-sky-300">{tt.newLevelMessage(chosenLevel)}</p>
        ) : (
          <p className="text-zinc-500 text-sm">{tt.sameLevelMessage}</p>
        )}
        <div className="flex gap-3">
          <button
            onClick={() => setPhase("choose")}
            className="border border-zinc-700 text-zinc-200 px-5 py-2 rounded-lg hover:border-sky-400 transition"
          >
            {tt.takeAnother}
          </button>
        </div>
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
    <div className="flex-1 bg-black text-zinc-100 flex flex-col items-center justify-center gap-8 p-6">
      <p className="text-zinc-500 text-xs uppercase tracking-wide">
        {tt.questionProgress(chosenLevel, index + 1, questions.length)}
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
