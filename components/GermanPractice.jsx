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
  const [communityResults, setCommunityResults] = useState([]);

  // "all" mixes questions from every level; picking a specific level
  // switches into manual review mode, which doesn't affect leveling.
  const [practiceLevel, setPracticeLevel] = useState("all");
  const [practiceTopic, setPracticeTopic] = useState("all");
  const [topics, setTopics] = useState([]);

  const fetchQuestion = useCallback(async (level, topic, avoidId) => {
    setLoadingQuestion(true);
    let query = supabase.from("german_questions").select("*");
    if (level && level !== "all") query = query.eq("level", level);
    if (topic && topic !== "all") query = query.eq("topic", topic);
    const { data, error } = await query;

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

  const loadTopics = useCallback(async (level) => {
    let query = supabase.from("german_questions").select("topic");
    if (level && level !== "all") query = query.eq("level", level);
    const { data } = await query;
    const unique = [...new Set((data || []).map((d) => d.topic).filter(Boolean))].sort((a, b) =>
      a.localeCompare(b)
    );
    setTopics(unique);
  }, []);

  function resetQuestionUI() {
    setSelected(null);
    setAnswered(false);
    setSelectedFriend("");
    setSendStatus("idle");
    setLevelChangeNote("");
    setCommunityResults([]);
  }

  // Initial load, once.
  useEffect(() => {
    fetchQuestion("all", "all", null);
    loadTopics("all");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  function handleLevelChange(newLevel) {
    setPracticeLevel(newLevel);
    setPracticeTopic("all");
    resetQuestionUI();
    loadTopics(newLevel);
    fetchQuestion(newLevel, "all", question?.id);
  }

  function handleTopicChange(newTopic) {
    setPracticeTopic(newTopic);
    resetQuestionUI();
    fetchQuestion(practiceLevel, newTopic, question?.id);
  }

  async function handleSelect(optionKey) {
    if (answered || !question) return;
    setSelected(optionKey);
    setAnswered(true);

    const correct = optionKey === question.correct_option;

    // Log this attempt, then pull everyone's latest attempt on this exact
    // question so the "how did others do" panel can show up immediately.
    await supabase.from("question_attempts").insert({
      user_id: user.id,
      question_id: question.id,
      selected_option: optionKey,
      correct,
    });

    const { data: attempts } = await supabase
      .from("question_attempts")
      .select("user_id, selected_option, correct, answered_at")
      .eq("question_id", question.id)
      .order("answered_at", { ascending: false });

    if (attempts) {
      const latestByUser = {};
      for (const a of attempts) {
        if (!(a.user_id in latestByUser)) latestByUser[a.user_id] = a;
      }
      const userIds = Object.keys(latestByUser);
      const { data: people } = await supabase
        .from("german_stats")
        .select("user_id, display_name")
        .in("user_id", userIds);
      const nameMap = Object.fromEntries((people || []).map((p) => [p.user_id, p.display_name]));
      const list = Object.values(latestByUser).map((a) => ({
        ...a,
        name: a.user_id === user.id ? "You" : nameMap[a.user_id] || "Someone",
      }));
      list.sort((a, b) => (a.name === "You" ? -1 : b.name === "You" ? 1 : 0));
      setCommunityResults(list);
    }
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

    // Update overall + per-level totals — this always happens, regardless
    // of auto vs manual mode.
    const levelStats = { ...stats.level_stats };
    const prev = levelStats[level] || { correct: 0, total: 0 };
    levelStats[level] = {
      correct: prev.correct + (correct ? 1 : 0),
      total: prev.total + 1,
    };
    const totalAnswered = stats.total_answered + 1;
    const totalCorrect = stats.total_correct + (correct ? 1 : 0);

    let newLevel = stats.current_level;
    let note = "";

    // Adaptive leveling only applies while mixing all levels, and only for
    // questions that happen to land on your actual current level — picking
    // a specific level to review deliberately never moves you.
    if (practiceLevel === "all" && level === stats.current_level) {
      const updatedWindow = [...recentAnswers, correct];
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

    resetQuestionUI();
    fetchQuestion(practiceLevel, practiceTopic, question.id);
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
      <div className="flex flex-wrap items-center justify-center gap-3 text-xs text-zinc-400">
        <span className="px-3 py-1 rounded-full bg-zinc-900 border border-zinc-700 text-zinc-200">
          Your level: {stats.current_level}
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

      <div className="flex flex-wrap items-center justify-center gap-2">
        <select
          value={practiceLevel}
          onChange={(e) => handleLevelChange(e.target.value)}
          className="bg-zinc-900 border border-zinc-700 text-zinc-200 text-xs rounded-lg px-2 py-1.5 focus:outline-none focus:border-amber-400"
        >
          <option value="all">All levels</option>
          {LEVELS.map((lvl) => (
            <option key={lvl} value={lvl}>
              {lvl}
            </option>
          ))}
        </select>

        <select
          value={practiceTopic}
          onChange={(e) => handleTopicChange(e.target.value)}
          className="bg-zinc-900 border border-zinc-700 text-zinc-200 text-xs rounded-lg px-2 py-1.5 focus:outline-none focus:border-amber-400"
        >
          <option value="all">All topics</option>
          {topics.map((topic) => (
            <option key={topic} value={topic}>
              {topic}
            </option>
          ))}
        </select>
      </div>

      {practiceLevel !== "all" && (
        <p className="text-[11px] text-zinc-500">
          Reviewing {practiceLevel} — this won't change your actual level.
        </p>
      )}

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
        <div className="flex flex-col items-center gap-3 w-full max-w-md">
          <p className={selected === question.correct_option ? "text-emerald-300" : "text-rose-300"}>
            {selected === question.correct_option ? "Correct!" : "Not quite."}
          </p>
          {levelChangeNote && <p className="text-amber-300 text-sm">{levelChangeNote}</p>}

          {communityResults.length > 0 && (
            <div className="w-full bg-zinc-900 border border-zinc-800 rounded-xl p-3 flex flex-col gap-1">
              <p className="text-[10px] text-zinc-500 uppercase tracking-wide">
                Everyone's answers on this question
              </p>
              {communityResults.map((r) => (
                <p
                  key={r.user_id}
                  className={`text-xs ${r.correct ? "text-emerald-300" : "text-rose-300"}`}
                >
                  {r.name}: {r.selected_option.toUpperCase()} {r.correct ? "✓" : "✗"}
                </p>
              ))}
            </div>
          )}

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
