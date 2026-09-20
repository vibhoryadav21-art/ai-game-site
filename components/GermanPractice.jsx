import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";
import { useLanguage } from "@/context/LanguageContext";

const LEVELS = ["A1", "A2", "B1", "B2", "C1"]; // content difficulty tags, unrelated to badges now
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

export default function GermanPractice({ user, stats, onStatsChange }) {
  const { t, language } = useLanguage();
  const [question, setQuestion] = useState(null);
  const [loadingQuestion, setLoadingQuestion] = useState(true);
  const [selected, setSelected] = useState(null);
  const [answered, setAnswered] = useState(false);
  const [friends, setFriends] = useState([]);
  const [selectedFriend, setSelectedFriend] = useState("");
  const [sendStatus, setSendStatus] = useState("idle"); // idle | sending | sent | error
  const [communityResults, setCommunityResults] = useState([]);
  const [explanation, setExplanation] = useState("");
  const [explanationLoading, setExplanationLoading] = useState(false);
  const [explanationError, setExplanationError] = useState("");
  const [poolSize, setPoolSize] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState("");
  const [generateSuccess, setGenerateSuccess] = useState("");

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
      setPoolSize(0);
      setLoadingQuestion(false);
      return;
    }

    setPoolSize(data.length);

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
    setCommunityResults([]);
    setExplanation("");
    setExplanationError("");
    setGenerateSuccess("");
    setGenerateError("");
  }

  // Initial load, once.
  useEffect(() => {
    fetchQuestion("all", "all", null);
    loadTopics("all");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    async function loadFriends() {
      if (!stats.default_crew_id) {
        setFriends([]);
        return;
      }
      const { data: members } = await supabase
        .from("crew_members")
        .select("user_id")
        .eq("crew_id", stats.default_crew_id)
        .eq("status", "member")
        .neq("user_id", user.id);

      const memberIds = (members || []).map((m) => m.user_id);
      if (memberIds.length === 0) {
        setFriends([]);
        return;
      }

      const { data, error } = await supabase
        .from("german_stats")
        .select("user_id, display_name")
        .in("user_id", memberIds);
      if (!error && data) setFriends(data);
    }
    loadFriends();
  }, [user.id, stats.default_crew_id]);

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

    // Only show answers from people in your default crew — pulling every
    // registered user gets unwieldy once the group grows past a handful.
    if (!stats.default_crew_id) {
      return;
    }

    const { data: crewMembers } = await supabase
      .from("crew_members")
      .select("user_id")
      .eq("crew_id", stats.default_crew_id)
      .eq("status", "member");

    const allowedUserIds = (crewMembers || []).map((m) => m.user_id);
    if (allowedUserIds.length === 0) return;

    const { data: attempts } = await supabase
      .from("question_attempts")
      .select("user_id, selected_option, correct, answered_at")
      .eq("question_id", question.id)
      .in("user_id", allowedUserIds)
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
        name: a.user_id === user.id ? t.practice.you : nameMap[a.user_id] || "Someone",
      }));
      list.sort((a, b) => (a.name === t.practice.you ? -1 : b.name === t.practice.you ? 1 : 0));
      setCommunityResults(list);
    }
  }

  async function generateMoreQuestions() {
    setGenerating(true);
    setGenerateError("");
    setGenerateSuccess("");
    try {
      const res = await fetch("/api/ai/generate-questions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          table: "german_questions",
          level: practiceLevel,
          topic: practiceTopic !== "all" ? practiceTopic : undefined,
          count: 5,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      setGenerateSuccess(`Added ${data.insertedCount} new questions.`);
      loadTopics(practiceLevel);
      fetchQuestion(practiceLevel, practiceTopic, question?.id);
    } catch (err) {
      setGenerateError("Couldn't generate questions — try again.");
    } finally {
      setGenerating(false);
    }
  }

  async function handleExplain() {
    const cached = question.explanations?.[language];
    if (cached) {
      setExplanation(cached);
      return;
    }

    setExplanationLoading(true);
    setExplanationError("");
    try {
      const res = await fetch("/api/ai/explain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          table: "german_questions",
          questionId: question.id,
          question: question.question,
          options: {
            a: question.option_a,
            b: question.option_b,
            c: question.option_c,
            d: question.option_d,
          },
          correctOption: question.correct_option,
          userOption: selected,
          language,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      setExplanation(data.explanation);
      setQuestion((q) => ({
        ...q,
        explanations: { ...(q.explanations || {}), [language]: data.explanation },
      }));
    } catch (err) {
      setExplanationError("Couldn't get an explanation — try again.");
    } finally {
      setExplanationLoading(false);
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

    // level_stats keeps tracking per-difficulty accuracy for future
    // breakdowns — it just no longer drives an automatic level anymore.
    const levelStats = { ...stats.level_stats };
    const prev = levelStats[level] || { correct: 0, total: 0 };
    levelStats[level] = {
      correct: prev.correct + (correct ? 1 : 0),
      total: prev.total + 1,
    };
    const totalAnswered = stats.total_answered + 1;
    const totalCorrect = stats.total_correct + (correct ? 1 : 0);

    // The badge score: +1 for a correct answer, -1 for a wrong one, never
    // below zero. The badge itself is just this score read through BADGES.
    const newScore = Math.max(0, (stats.score || 0) + (correct ? 1 : -1));

    const updatedStats = {
      ...stats,
      score: newScore,
      total_answered: totalAnswered,
      total_correct: totalCorrect,
      level_stats: levelStats,
    };

    onStatsChange(updatedStats);

    await supabase
      .from("german_stats")
      .update({
        score: newScore,
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
      <div className="flex-1 bg-black text-zinc-100 flex items-center justify-center">
        <p className="text-zinc-400">{t.practice.loadingQuestion}</p>
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
    <div className="flex-1 bg-black text-zinc-100 flex flex-col items-center justify-center gap-6 p-6">
      <div className="flex flex-wrap items-center justify-center gap-3 text-xs text-zinc-400">
        <span className="px-3 py-1 rounded-full bg-zinc-900 border border-zinc-700 text-zinc-200">
          {getBadge(stats.score || 0)} · {stats.score || 0} {t.practice.pointsSuffix}
        </span>
        <span className="px-3 py-1 rounded-full bg-zinc-900 border border-zinc-700 text-zinc-200">
          CEFR: {stats.current_level}
        </span>
        <span>{t.practice.overallCorrect(stats.total_correct, stats.total_answered)}</span>
        <Link href="/learning/german/inbox" className="text-sky-300 hover:text-sky-200 transition">
          {t.practice.inbox}
        </Link>
        <Link href="/learning/german/leaderboard" className="text-sky-300 hover:text-sky-200 transition">
          {t.practice.leaderboard}
        </Link>
        <Link href="/learning/german/level-test" className="text-sky-300 hover:text-sky-200 transition">
          Take a level test
        </Link>
        <Link href="/learning/german/writing" className="text-sky-300 hover:text-sky-200 transition">
          Practice writing
        </Link>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-2">
        <select
          value={practiceLevel}
          onChange={(e) => handleLevelChange(e.target.value)}
          className="bg-zinc-900 border border-zinc-700 text-zinc-200 text-xs rounded-lg px-2 py-1.5 focus:outline-none focus:border-sky-400"
        >
          <option value="all">{t.practice.allLevels}</option>
          {LEVELS.map((lvl) => (
            <option key={lvl} value={lvl}>
              {lvl}
            </option>
          ))}
        </select>

        <select
          value={practiceTopic}
          onChange={(e) => handleTopicChange(e.target.value)}
          className="bg-zinc-900 border border-zinc-700 text-zinc-200 text-xs rounded-lg px-2 py-1.5 focus:outline-none focus:border-sky-400"
        >
          <option value="all">{t.practice.allTopics}</option>
          {topics.map((topic) => (
            <option key={topic} value={topic}>
              {topic}
            </option>
          ))}
        </select>
      </div>

      {practiceLevel !== "all" && (
        <p className="text-[11px] text-zinc-500">{t.practice.practicingOnly(practiceLevel)}</p>
      )}

      {practiceLevel !== "all" && poolSize !== null && poolSize < 5 && (
        <div className="flex flex-col items-center gap-1">
          <p className="text-[11px] text-amber-400">
            Only {poolSize} question{poolSize === 1 ? "" : "s"} available for this filter.
          </p>
          {!generating && !generateSuccess && (
            <button
              onClick={generateMoreQuestions}
              className="text-xs text-sky-300 hover:text-sky-200 underline underline-offset-2 transition"
            >
              Generate 5 more
            </button>
          )}
          {generating && <p className="text-xs text-zinc-500">Generating…</p>}
          {generateSuccess && <p className="text-xs text-emerald-300">{generateSuccess}</p>}
          {generateError && <p className="text-xs text-rose-300">{generateError}</p>}
        </div>
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
            {selected === question.correct_option ? t.practice.correctFeedback : t.practice.wrongFeedback}
          </p>

          {selected !== question.correct_option && (
            <div className="w-full flex flex-col gap-2">
              {!explanation && !explanationLoading && (
                <button
                  onClick={handleExplain}
                  className="text-xs text-sky-300 hover:text-sky-200 underline underline-offset-2 transition self-start"
                >
                  Explain
                </button>
              )}
              {explanationLoading && <p className="text-xs text-zinc-500">Thinking…</p>}
              {explanation && (
                <div className="w-full bg-zinc-900 border border-sky-900/50 rounded-xl p-3">
                  <p className="text-xs text-zinc-300 leading-relaxed">{explanation}</p>
                </div>
              )}
              {explanationError && <p className="text-xs text-rose-300">{explanationError}</p>}
            </div>
          )}

          {communityResults.length > 0 && (
            <div className="w-full bg-zinc-900 border border-zinc-800 rounded-xl p-3 flex flex-col gap-1">
              <p className="text-[10px] text-zinc-500 uppercase tracking-wide">
                {t.practice.everyoneAnswers}
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

          {!stats.default_crew_id && (
            <p className="text-[10px] text-zinc-500">
              <Link href="/learning/german/leaderboard" className="text-sky-300 hover:text-sky-200 transition">
                Pick a crew
              </Link>{" "}
              to see how your friends answer these.
            </p>
          )}

          {friends.length > 0 && (
            <div className="flex items-center gap-2">
              {sendStatus === "sent" ? (
                <p className="text-xs text-emerald-300">{t.practice.sent}</p>
              ) : (
                <>
                  <select
                    value={selectedFriend}
                    onChange={(e) => setSelectedFriend(e.target.value)}
                    className="bg-zinc-900 border border-zinc-700 text-zinc-200 text-xs rounded-lg px-2 py-1.5 focus:outline-none focus:border-sky-400"
                  >
                    <option value="">{t.practice.sendPrompt}</option>
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
                    {sendStatus === "sending" ? t.practice.sending : t.practice.send}
                  </button>
                </>
              )}
              {sendStatus === "error" && (
                <p className="text-xs text-rose-300">{t.practice.sendError}</p>
              )}
            </div>
          )}

          <button
            onClick={handleNext}
            className="bg-sky-500 hover:bg-sky-400 text-zinc-950 font-medium px-6 py-2 rounded-xl transition"
          >
            {t.practice.nextQuestion}
          </button>
        </div>
      )}
    </div>
  );
}
