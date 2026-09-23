import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";
import { useLanguage } from "@/context/LanguageContext";

const LEVELS = ["A1", "A2", "B1", "B2", "C1"]; // content difficulty tags, unrelated to badges now
const BADGES = [
  { min: 0, name: "Beginner", icon: "/badges/beginner.png" },
  { min: 10, name: "Challenger", icon: "/badges/challenger.png" },
  { min: 20, name: "Advanced", icon: "/badges/advanced.png" },
  { min: 30, name: "Pro", icon: "/badges/pro.png" },
  { min: 50, name: "Master", icon: "/badges/quizmaster.png" },
];

function getBadge(score) {
  let badge = BADGES[0];
  for (const tier of BADGES) {
    if (score >= tier.min) badge = tier;
  }
  return badge;
}

export default function GermanPractice({ user, stats, onStatsChange, lockFavoritesOnly = false }) {
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
  const [menuOpen, setMenuOpen] = useState(false);
  const [topics, setTopics] = useState([]);

  // Repeat avoidance: which question ids this user has already seen, and
  // when. A question only counts as "seen" if it was answered after the
  // most recent reset for its scope (level+topic+favorites combo) — this
  // is entirely separate from crew challenges, which will track their own
  // no-repeat history independently.
  const [seenIds, setSeenIds] = useState(() => new Set());
  const [lastSeenAt, setLastSeenAt] = useState({});
  const [resetAtByScope, setResetAtByScope] = useState({});

  // Favorites: question ids the user has starred to revisit later. Whether
  // this instance is favorites-only is fixed for its lifetime by the
  // lockFavoritesOnly prop (set by the dedicated /favorites page) — there's
  // no in-page toggle anymore now that favorites have their own page.
  const [favoriteIds, setFavoriteIds] = useState(() => new Set());

  // Why `question` is currently null, so the UI can show the right empty
  // state: 'no-favorites' | 'no-match' | 'completed' | null.
  const [completionReason, setCompletionReason] = useState(null);

  function scopeKey(level, topic) {
    return `level=${level || "all"}|topic=${topic || "all"}`;
  }

  function currentCategoryLabel() {
    if (lockFavoritesOnly) {
      if (practiceTopic !== "all") return `${practiceTopic} favorites`;
      if (practiceLevel !== "all") return `${practiceLevel} favorites`;
      return "your favorites";
    }
    if (practiceTopic !== "all" && practiceLevel !== "all") return `${practiceLevel} · ${practiceTopic}`;
    if (practiceTopic !== "all") return practiceTopic;
    if (practiceLevel !== "all") return practiceLevel;
    return "all questions";
  }

  // Load every question id this user has already answered, plus when, so
  // fetchQuestion can avoid repeats. Runs once — after that we keep the
  // sets updated locally as the user answers, so we don't need to refetch
  // on every question.
  const loadAttemptHistory = useCallback(async (userId) => {
    const { data, error } = await supabase
      .from("question_attempts")
      .select("question_id, answered_at")
      .eq("user_id", userId)
      .order("answered_at", { ascending: true });

    if (error) {
      console.error("Failed to load attempt history:", error.message);
      return;
    }

    const ids = new Set();
    const lastSeen = {};
    for (const row of data || []) {
      ids.add(row.question_id);
      lastSeen[row.question_id] = row.answered_at;
    }
    setSeenIds(ids);
    setLastSeenAt(lastSeen);
  }, []);

  const loadResets = useCallback(async (userId) => {
    const { data, error } = await supabase
      .from("practice_resets")
      .select("scope_key, reset_at")
      .eq("user_id", userId);

    if (error) {
      console.error("Failed to load practice resets:", error.message);
      return;
    }
    const map = {};
    for (const row of data || []) {
      map[row.scope_key] = row.reset_at;
    }
    setResetAtByScope(map);
  }, []);

  const loadFavorites = useCallback(async (userId) => {
    const { data, error } = await supabase
      .from("favorite_questions")
      .select("question_id")
      .eq("user_id", userId);

    if (error) {
      console.error("Failed to load favorites:", error.message);
      return;
    }
    setFavoriteIds(new Set((data || []).map((r) => r.question_id)));
  }, []);

  const fetchQuestion = useCallback(
    async (level, topic, avoidId, options = {}) => {
      setLoadingQuestion(true);
      setCompletionReason(null);
      let query = supabase.from("german_questions").select("*");
      if (level && level !== "all") query = query.eq("level", level);
      if (topic && topic !== "all") query = query.eq("topic", topic);
      if (lockFavoritesOnly) {
        const ids = Array.from(favoriteIds);
        if (ids.length === 0) {
          setQuestion(null);
          setPoolSize(0);
          setCompletionReason("no-favorites");
          setLoadingQuestion(false);
          return;
        }
        query = query.in("id", ids);
      }
      const { data: rawData, error } = await query;

      if (error || !rawData) {
        console.error("Failed to load question:", error?.message);
        setQuestion(null);
        setPoolSize(0);
        setCompletionReason("no-match");
        setLoadingQuestion(false);
        return;
      }

      // The main practice flow deliberately excludes favorited questions —
      // those are considered already-seen material set aside for the
      // dedicated Favorites page, not the regular rotation.
      const data = lockFavoritesOnly ? rawData : rawData.filter((q) => !favoriteIds.has(q.id));

      if (data.length === 0) {
        setQuestion(null);
        setPoolSize(0);
        setCompletionReason(!lockFavoritesOnly && rawData.length > 0 ? "all-favorited" : "no-match");
        setLoadingQuestion(false);
        return;
      }

      setPoolSize(data.length);

      let candidates;
      if (lockFavoritesOnly) {
        // Favorites are meant to be revisited on purpose, repeatedly — the
        // no-repeat gate doesn't apply here, or every already-answered
        // favorite would immediately look "completed".
        candidates = data;
      } else {
        // A question counts as unseen if we've never logged an attempt for
        // it, or if the last attempt was before this scope's reset time.
        // resetAtOverride lets a just-triggered reset take effect on this
        // very call, since the resetAtByScope state won't have re-rendered
        // into this closure yet.
        const resetAt = options.resetAtOverride ?? resetAtByScope[scopeKey(level, topic)];
        const unseen = data.filter((q) => {
          if (!seenIds.has(q.id)) return true;
          if (resetAt && lastSeenAt[q.id] && new Date(lastSeenAt[q.id]) < new Date(resetAt)) return true;
          return false;
        });

        if (unseen.length === 0) {
          // Every question in this filter has already been answered — stop
          // instead of looping back through them, and let the user decide
          // whether to reset this category.
          setQuestion(null);
          setCompletionReason("completed");
          setLoadingQuestion(false);
          return;
        }
        candidates = unseen;
      }

      if (candidates.length > 1 && avoidId) {
        const withoutAvoid = candidates.filter((q) => q.id !== avoidId);
        if (withoutAvoid.length > 0) candidates = withoutAvoid;
      }

      const pick = candidates[Math.floor(Math.random() * candidates.length)];
      setQuestion(pick);
      setLoadingQuestion(false);
    },
    [seenIds, lastSeenAt, resetAtByScope, favoriteIds, lockFavoritesOnly]
  );

  async function resetCurrentCategory() {
    const key = scopeKey(practiceLevel, practiceTopic);
    const resetAt = new Date().toISOString();
    const { error } = await supabase
      .from("practice_resets")
      .upsert({ user_id: user.id, scope_key: key, reset_at: resetAt }, { onConflict: "user_id,scope_key" });

    if (error) {
      console.error("Failed to reset progress:", error.message);
      return;
    }
    setResetAtByScope((prev) => ({ ...prev, [key]: resetAt }));
    resetQuestionUI();
    fetchQuestion(practiceLevel, practiceTopic, null, { resetAtOverride: resetAt });
  }

  async function toggleFavorite(questionId) {
    const isFavorited = favoriteIds.has(questionId);

    // Optimistic update so the star responds immediately.
    setFavoriteIds((prev) => {
      const next = new Set(prev);
      if (isFavorited) next.delete(questionId);
      else next.add(questionId);
      return next;
    });

    if (isFavorited) {
      const { error } = await supabase
        .from("favorite_questions")
        .delete()
        .eq("user_id", user.id)
        .eq("question_id", questionId);
      if (error) {
        console.error("Failed to remove favorite:", error.message);
        setFavoriteIds((prev) => new Set(prev).add(questionId)); // revert
      }
    } else {
      const { error } = await supabase
        .from("favorite_questions")
        .insert({ user_id: user.id, question_id: questionId });
      if (error) {
        console.error("Failed to add favorite:", error.message);
        setFavoriteIds((prev) => {
          const next = new Set(prev);
          next.delete(questionId); // revert
          return next;
        });
      }
    }
  }

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

  // Initial load, once. Wait for attempt history + resets so the very
  // first question picked already respects no-repeat, instead of only
  // kicking in later.
  useEffect(() => {
    loadTopics("all");
    loadFavorites(user.id);
    Promise.all([loadAttemptHistory(user.id), loadResets(user.id)]).then(() =>
      fetchQuestion("all", "all", null)
    );
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

    // Mark this question as seen right away so the next fetchQuestion call
    // (triggered by "Next") won't need a round trip to know to skip it.
    const seenAt = new Date().toISOString();
    setSeenIds((prev) => new Set(prev).add(question.id));
    setLastSeenAt((prev) => ({ ...prev, [question.id]: seenAt }));

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

  let body;
  if (loadingQuestion) {
    body = (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-zinc-400">{t.practice.loadingQuestion}</p>
      </div>
    );
  } else if (!question) {
    if (completionReason === "completed") {
      body = (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 p-6 text-center">
          <p className="text-2xl">🎉</p>
          <p className="text-xl text-zinc-100">
            Hurray! You&apos;ve completed <span className="text-sky-300">{currentCategoryLabel()}</span>
          </p>
          <p className="text-sm text-zinc-400 max-w-sm">
            You&apos;ve answered every question here. Reset to go through them again, or pick a
            different level or topic above.
          </p>
          <button
            onClick={resetCurrentCategory}
            className="bg-sky-500 hover:bg-sky-400 text-zinc-950 font-medium px-5 py-2 rounded-xl transition"
          >
            Reset and practice again
          </button>
        </div>
      );
    } else if (completionReason === "all-favorited") {
      body = (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 p-6 text-center">
          <p className="text-xl text-zinc-100">
            You&apos;ve favorited every question in{" "}
            <span className="text-sky-300">{currentCategoryLabel()}</span>
          </p>
          <p className="text-sm text-zinc-400 max-w-sm">
            They&apos;re all saved for review on your Favorites page. Pick a different level or
            topic above to keep practicing new questions.
          </p>
          <Link
            href="/learning/german/favorites"
            className="bg-sky-500 hover:bg-sky-400 text-zinc-950 font-medium px-5 py-2 rounded-xl transition"
          >
            Review favorites
          </Link>
        </div>
      );
    } else {
      body = (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 p-6 text-center">
          <p className="text-zinc-300">
            {completionReason === "no-favorites"
              ? "No favorites yet — tap the star on a question to save it here for later."
              : "No questions match this filter yet."}
          </p>
        </div>
      );
    }
  } else {
    const options = [
      { key: "a", text: question.option_a },
      { key: "b", text: question.option_b },
      { key: "c", text: question.option_c },
      { key: "d", text: question.option_d },
    ];

    body = (
      <>
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

        <div className="flex items-start justify-center gap-2 max-w-md w-full">
          <p className="text-xl text-center flex-1">{question.question}</p>
          <button
            onClick={() => toggleFavorite(question.id)}
            aria-label={favoriteIds.has(question.id) ? "Remove from favorites" : "Add to favorites"}
            aria-pressed={favoriteIds.has(question.id)}
            className={`shrink-0 w-8 h-8 flex items-center justify-center rounded-full border transition ${
              favoriteIds.has(question.id)
                ? "bg-amber-400/10 border-amber-400 text-amber-300"
                : "bg-zinc-900 border-zinc-700 text-zinc-500 hover:border-amber-400 hover:text-amber-300"
            }`}
          >
            <svg
              viewBox="0 0 24 24"
              width="16"
              height="16"
              fill={favoriteIds.has(question.id) ? "currentColor" : "none"}
              stroke="currentColor"
              strokeWidth="1.8"
            >
              <polygon points="12 2.5 15 9 22 10 16.8 14.7 18.2 21.5 12 18 5.8 21.5 7.2 14.7 2 10 9 9 12 2.5" />
            </svg>
          </button>
        </div>

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
          <div className="w-full max-w-md flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className={selected === question.correct_option ? "text-emerald-300" : "text-rose-300"}>
                {selected === question.correct_option ? t.practice.correctFeedback : t.practice.wrongFeedback}
              </p>
              <button
                onClick={handleNext}
                className="bg-sky-500 hover:bg-sky-400 text-zinc-950 font-medium px-6 py-2 rounded-xl transition shrink-0"
              >
                {t.practice.nextQuestion}
              </button>
            </div>

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
          </div>
        )}
      </>
    );
  }

  return (
    <div className="relative flex-1 bg-black text-zinc-100 flex flex-col items-center gap-4 px-6 pt-16 pb-6">
      <div className="absolute top-4 right-4">
        <button
          onClick={() => setMenuOpen(true)}
          aria-label={t.practice.menu}
          className="w-9 h-9 flex items-center justify-center rounded-full bg-zinc-900 border border-zinc-700 text-zinc-200 hover:border-sky-400 transition"
        >
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <circle cx="12" cy="7.5" r="1.4" fill="currentColor" stroke="none" />
            <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
            <circle cx="12" cy="16.5" r="1.4" fill="currentColor" stroke="none" />
          </svg>
        </button>
      </div>

      {/* Slide-in menu panel */}
      <div
        className={`fixed inset-0 z-30 transition-opacity duration-300 ${
          menuOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        }`}
      >
        <div className="absolute inset-0 bg-black/60" onClick={() => setMenuOpen(false)} />
        <div
          className={`absolute right-0 top-0 h-full w-72 max-w-[85%] bg-zinc-900 border-l border-zinc-800 shadow-xl flex flex-col transition-transform duration-300 ${
            menuOpen ? "translate-x-0" : "translate-x-full"
          }`}
        >
          <div className="flex items-center justify-between px-4 py-4 border-b border-zinc-800">
            <span className="text-base text-zinc-100">{t.practice.menu}</span>
            <button
              onClick={() => setMenuOpen(false)}
              aria-label={t.practice.close}
              className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-zinc-800 text-zinc-300 transition"
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="5" y1="5" x2="19" y2="19" />
                <line x1="19" y1="5" x2="5" y2="19" />
              </svg>
            </button>
          </div>

          <div className="flex flex-col gap-2 px-4 py-4 border-b border-zinc-800">
            <span className="flex items-center gap-2 pl-1 pr-3 py-2 rounded-full bg-zinc-950 border border-zinc-700 text-zinc-200 text-sm w-fit">
              <img src={getBadge(stats.score || 0).icon} alt="" className="w-7 h-7 object-contain" />
              {getBadge(stats.score || 0).name} · {stats.score || 0} {t.practice.pointsSuffix}
            </span>
            <span className="px-3 py-1.5 rounded-full bg-zinc-950 border border-zinc-700 text-zinc-200 text-sm w-fit">
              {t.practice.cefrLabel(stats.current_level)}
            </span>
          </div>

          <nav className="flex flex-col py-2">
            <Link
              href="/learning/german/favorites"
              onClick={() => setMenuOpen(false)}
              className="px-4 py-4 text-base text-zinc-200 hover:bg-zinc-800 transition"
            >
              Favorites
            </Link>
            <Link
              href="/learning/german/inbox"
              onClick={() => setMenuOpen(false)}
              className="px-4 py-4 text-base text-zinc-200 hover:bg-zinc-800 transition"
            >
              {t.practice.inbox}
            </Link>
            <Link
              href="/learning/german/leaderboard"
              onClick={() => setMenuOpen(false)}
              className="px-4 py-4 text-base text-zinc-200 hover:bg-zinc-800 transition"
            >
              {t.practice.leaderboard}
            </Link>
            <Link
              href="/learning/german/level-test"
              onClick={() => setMenuOpen(false)}
              className="px-4 py-4 text-base text-zinc-200 hover:bg-zinc-800 transition"
            >
              {t.practice.levelTest}
            </Link>
            <Link
              href="/learning/german/writing"
              onClick={() => setMenuOpen(false)}
              className="px-4 py-4 text-base text-zinc-200 hover:bg-zinc-800 transition"
            >
              {t.practice.practiceWriting}
            </Link>
          </nav>
        </div>
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

        {lockFavoritesOnly && (
          <Link
            href="/learning/german"
            className="flex items-center gap-1 text-xs rounded-lg px-2 py-1.5 border border-zinc-700 text-zinc-200 hover:border-sky-400 transition"
          >
            All questions
          </Link>
        )}
      </div>

      {practiceLevel !== "all" && (
        <p className="text-[11px] text-zinc-500">{t.practice.practicingOnly(practiceLevel)}</p>
      )}

      {body}
    </div>
  );
}
