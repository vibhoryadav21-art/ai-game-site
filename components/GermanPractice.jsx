import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";

const LEVELS = ["A1", "A2", "B1", "B2", "C1"];
const WINDOW_SIZE = 5;
const LEVEL_UP_THRESHOLD = 4; // 4/5 correct (80%) moves you up
const LEVEL_DOWN_THRESHOLD = 2; // 2/5 or fewer correct (40%) moves you down

export default function GermanPractice({ user, stats, onStatsChange }) {
  const [question, setQuestion] = useState(null);
  const [loadingQuestion, setLoadingQuestion] = useState(true);
  const [selected, setSelected] = useState(null);
  const [answered, setAnswered] = useState(false);
  const [recentAnswers, setRecentAnswers] = useState([]);
  const [levelChangeNote, setLevelChangeNote] = useState("");
  const [friends, setFriends] = useState([]);
  const [selectedFriend, setSelectedFriend] = useState("");
  const [sendStatus, setSendStatus] = useState("idle"); // idle | sending | sent | error

  useEffect(() => {
    async function loadFriends() {
      const { data, error } = await supabase
        .from("german_stats")
        .select("user_id, display_name")
        .neq("user_id", user.id);
      if (!error && data) setFriends(data);
    }
    loadFriends();
  }, [user.id]);

  const fetchQuestion = useCallback(async (level, avoidId) => {
    setLoadingQuestion(true);
    const { data, error } = await supabase
      .from("german_questions")
      .select("*")
      .eq("level", level);

    if (error || !data || data.length === 0) {
      console.error("Failed to load question:", error?.message);
      setQuestion(null);
      setLoadingQuestion(false);
      return;
    }

    let pool = data;
    if (data.length > 1 && avoidId) {
      pool = data.filter((q) => q.id !== avoidId);
    }
    const pick = pool[Math.floor(Math.random() * pool.length)];
    setQuestion(pick);
    setLoadingQuestion(false);
  }, []);

  useEffect(() => {
    fetchQuestion(stats.current_level, null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleSelect(optionKey) {
    if (answered) return;
    setSelected(optionKey);
    setAnswered(true);
  }

  async function sendToFriend() {
    if (!selectedFriend || !question) return;
    setSendStatus("sending");

    const { error } = await supabase.from("sent_questions").insert({
      question_id: question.id,
      sender_id: user.id,
      receiver_id: selectedFriend,
      sender_answer: selected,
      sender_correct: selected === question.correct_option,
    });

    if (error) {
      console.error("Failed to send question:", error.message);
      setSendStatus("error");
    } else {
      setSendStatus("sent");
    }
  }

  async function handleNext() {
    const correct = selected === question.correct_option;
    const level = question.level;

    // Update overall + per-level totals.
    const levelStats = { ...stats.level_stats };
    const prev = levelStats[level] || { correct: 0, total: 0 };
    levelStats[level] = {
      correct: prev.correct + (correct ? 1 : 0),
      total: prev.total + 1,
    };
    const totalAnswered = stats.total_answered + 1;
    const totalCorrect = stats.total_correct + (correct ? 1 : 0);

    // Track the last few answers *at the current level* to decide on a
    // level change every WINDOW_SIZE questions.
    const updatedWindow = [...recentAnswers, correct];
    let newLevel = stats.current_level;
    let note = "";

    if (updatedWindow.length >= WINDOW_SIZE) {
      const correctCount = updatedWindow.filter(Boolean).length;
      const currentIndex = LEVELS.indexOf(stats.current_level);

      if (correctCount >= LEVEL_UP_THRESHOLD && currentIndex < LEVELS.length - 1) {
        newLevel = LEVELS[currentIndex + 1];
        note = `${correctCount}/${WINDOW_SIZE} correct — leveling up to ${newLevel}!`;
      } else if (correctCount <= LEVEL_DOWN_THRESHOLD && currentIndex > 0) {
        newLevel = LEVELS[currentIndex - 1];
        note = `${correctCount}/${WINDOW_SIZE} correct — dropping back to ${newLevel} for now.`;
      }
      setRecentAnswers([]);
    } else {
      setRecentAnswers(updatedWindow);
    }

    const updatedStats = {
      ...stats,
      current_level: newLevel,
      total_answered: totalAnswered,
      total_correct: totalCorrect,
      level_stats: levelStats,
    };

    onStatsChange(updatedStats);
    setLevelChangeNote(note);

    await supabase
      .from("german_stats")
      .update({
        current_level: newLevel,
        total_answered: totalAnswered,
        total_correct: totalCorrect,
        level_stats: levelStats,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", user.id);

    setSelected(null);
    setAnswered(false);
    setSelectedFriend("");
    setSendStatus("idle");
    fetchQuestion(newLevel, question.id);
  }

  if (loadingQuestion || !question) {
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center">
        <p className="text-zinc-400">Loading question…</p>
      </div>
    );
  }

  const options = [
    { key: "a", text: question.option_a },
    { key: "b", text: question.option_b },
    { key: "c", text: question.option_c },
    { key: "d", text: question.option_d },
  ];

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col items-center justify-center gap-6 p-6">
      <div className="flex items-center gap-3 text-xs text-zinc-400">
        <span className="px-3 py-1 rounded-full bg-zinc-900 border border-zinc-700">
          Level {stats.current_level}
        </span>
        <span>
          {stats.total_correct}/{stats.total_answered} correct overall
        </span>
        <Link href="/learning/german/inbox" className="text-amber-300 hover:text-amber-200 transition">
          Inbox
        </Link>
        <Link href="/learning/german/leaderboard" className="text-amber-300 hover:text-amber-200 transition">
          Leaderboard
        </Link>
      </div>

      <p className="text-xl text-center max-w-md">{question.question}</p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full max-w-md">
        {options.map((opt) => {
          const isCorrectOption = opt.key === question.correct_option;
          const isSelected = opt.key === selected;
          let style = "bg-zinc-900 border-zinc-700 hover:bg-zinc-800";
          if (answered && isCorrectOption) {
            style = "bg-emerald-900 border-emerald-500 text-emerald-100";
          } else if (answered && isSelected && !isCorrectOption) {
            style = "bg-rose-950 border-rose-500 text-rose-100";
          }
          return (
            <button
              key={opt.key}
              onClick={() => handleSelect(opt.key)}
              disabled={answered}
              className={`border rounded-xl px-4 py-3 text-left transition ${style}`}
            >
              {opt.text}
            </button>
          );
        })}
      </div>

      {answered && (
        <div className="flex flex-col items-center gap-3">
          <p className={selected === question.correct_option ? "text-emerald-300" : "text-rose-300"}>
            {selected === question.correct_option ? "Correct!" : "Not quite."}
          </p>
          {levelChangeNote && <p className="text-amber-300 text-sm">{levelChangeNote}</p>}

          {friends.length > 0 && (
            <div className="flex items-center gap-2">
              {sendStatus === "sent" ? (
                <p className="text-xs text-emerald-300">Sent!</p>
              ) : (
                <>
                  <select
                    value={selectedFriend}
                    onChange={(e) => setSelectedFriend(e.target.value)}
                    className="bg-zinc-900 border border-zinc-700 text-zinc-200 text-xs rounded-lg px-2 py-1.5 focus:outline-none focus:border-amber-400"
                  >
                    <option value="">Send this question to…</option>
                    {friends.map((f) => (
                      <option key={f.user_id} value={f.user_id}>
                        {f.display_name}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={sendToFriend}
                    disabled={!selectedFriend || sendStatus === "sending"}
                    className="text-xs bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 text-zinc-200 px-3 py-1.5 rounded-lg transition"
                  >
                    {sendStatus === "sending" ? "Sending…" : "Send"}
                  </button>
                </>
              )}
              {sendStatus === "error" && (
                <p className="text-xs text-rose-300">Couldn't send — try again.</p>
              )}
            </div>
          )}

          <button
            onClick={handleNext}
            className="bg-amber-500 hover:bg-amber-400 text-zinc-950 font-medium px-6 py-2 rounded-xl transition"
          >
            Next question
          </button>
        </div>
      )}
    </div>
  );
}
