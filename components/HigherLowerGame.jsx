import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabaseClient";

const SUITS = [
  { symbol: "♠", color: "text-neutral-900" },
  { symbol: "♣", color: "text-neutral-900" },
  { symbol: "♥", color: "text-red-600" },
  { symbol: "♦", color: "text-red-600" },
];

const RANKS = [
  { label: "2", value: 2 },
  { label: "3", value: 3 },
  { label: "4", value: 4 },
  { label: "5", value: 5 },
  { label: "6", value: 6 },
  { label: "7", value: 7 },
  { label: "8", value: 8 },
  { label: "9", value: 9 },
  { label: "10", value: 10 },
  { label: "J", value: 11 },
  { label: "Q", value: 12 },
  { label: "K", value: 13 },
  { label: "A", value: 14 },
];

const GAMES = [
  { id: "higher_lower", label: "Higher or lower" },
  { id: "general", label: "General feedback" },
];

function buildDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ suit: suit.symbol, color: suit.color, label: rank.label, value: rank.value });
    }
  }
  return deck;
}

function shuffle(deck) {
  const copy = [...deck];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

const STARTING_MONEY = 1000;
const BASE_BET = 50;
const GUESSES_PER_STAGE = 10;
const FEEDBACK_LIMIT = 100;
const REVEAL_MS = 1200; // how long both cards stay visible side by side
const SETTLE_MS = 350; // how long the old card takes to fade out afterward

function betForStage(stage) {
  return BASE_BET * Math.pow(2, stage - 1);
}

function Card({ card }) {
  return (
    <div className="w-full h-full bg-white rounded-xl shadow-lg flex flex-col items-center justify-center">
      <span className={`text-4xl font-semibold ${card.color}`}>{card.label}</span>
      <span className={`text-4xl ${card.color}`}>{card.suit}</span>
    </div>
  );
}

export default function HigherLowerGame() {
  const [deck, setDeck] = useState([]);
  const [current, setCurrent] = useState(null);
  const [incoming, setIncoming] = useState(null);
  // phase: 'idle' (one card showing) -> 'compare' (both visible) -> 'settle' (old fading out)
  const [phase, setPhase] = useState("idle");
  const [money, setMoney] = useState(STARTING_MONEY);
  const [totalGuesses, setTotalGuesses] = useState(0);
  const stage = Math.floor(totalGuesses / GUESSES_PER_STAGE) + 1;
  const guessesInStage = totalGuesses % GUESSES_PER_STAGE;
  const [message, setMessage] = useState("Call it: will the next card be higher or lower?");
  const [wins, setWins] = useState(0);
  const [losses, setLosses] = useState(0);
  const [gameOver, setGameOver] = useState(false);

  // --- Account / saved-progress state ---
  const [user, setUser] = useState(null);
  const [statsLoaded, setStatsLoaded] = useState(false);

  // --- Feedback state ---
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackGame, setFeedbackGame] = useState("higher_lower");
  const [feedbackText, setFeedbackText] = useState("");
  const [feedbackSent, setFeedbackSent] = useState(false);
  const [feedbackError, setFeedbackError] = useState("");

  function resetLocalGame() {
    const fresh = shuffle(buildDeck());
    setCurrent(fresh[0]);
    setIncoming(null);
    setPhase("idle");
    setDeck(fresh.slice(1));
    setMoney(STARTING_MONEY);
    setTotalGuesses(0);
    setWins(0);
    setLosses(0);
    setMessage("Call it: will the next card be higher or lower?");
    setGameOver(false);
  }

  // Deal the very first card once, on mount.
  useEffect(() => {
    resetLocalGame();
  }, []);

  // Load a logged-in player's saved stats (or create their row the first
  // time), and keep listening in case they log in/out while on this page.
  useEffect(() => {
    let active = true;

    async function loadOrCreateStats(userId) {
      const { data, error } = await supabase
        .from("game_stats")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle();

      if (!active) return;

      if (error) {
        console.error("Failed to load game stats:", error.message);
      } else if (data) {
        setMoney(data.money);
        setWins(data.wins);
        setLosses(data.losses);
        setTotalGuesses(data.total_guesses);
        setGameOver(data.money <= 0);
      } else {
        // First time this user has played — create their row.
        await supabase.from("game_stats").insert({
          user_id: userId,
          money: STARTING_MONEY,
          wins: 0,
          losses: 0,
          total_guesses: 0,
        });
      }
      setStatsLoaded(true);
    }

    supabase.auth.getSession().then(({ data }) => {
      const sessionUser = data.session?.user ?? null;
      if (!active) return;
      setUser(sessionUser);
      if (sessionUser) {
        loadOrCreateStats(sessionUser.id);
      } else {
        setStatsLoaded(true);
      }
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      const sessionUser = session?.user ?? null;
      setUser(sessionUser);
      if (sessionUser) {
        setStatsLoaded(false);
        loadOrCreateStats(sessionUser.id);
      }
    });

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  // Persist stats to Supabase — only meaningful once we know who's logged in.
  async function saveStats(fields) {
    if (!user) return;
    const { error } = await supabase
      .from("game_stats")
      .upsert({ user_id: user.id, ...fields, updated_at: new Date().toISOString() });
    if (error) console.error("Failed to save game stats:", error.message);
  }

  function drawFrom(deckToUse) {
    if (deckToUse.length < 1) {
      const reshuffled = shuffle(buildDeck());
      return { next: reshuffled[0], remaining: reshuffled.slice(1) };
    }
    return { next: deckToUse[0], remaining: deckToUse.slice(1) };
  }

  function handleGuess(guess) {
    if (gameOver || phase !== "idle" || !current || !statsLoaded) return;
    const bet = betForStage(stage);
    const { next, remaining } = drawFrom(deck);

    let newMoney = money;
    let newWins = wins;
    let newLosses = losses;

    if (next.value === current.value) {
      setMessage(`Push — both ${current.label}s. Your bet is safe.`);
    } else {
      const correct =
        (guess === "higher" && next.value > current.value) ||
        (guess === "lower" && next.value < current.value);
      newMoney = correct ? money + bet : money - bet;
      if (correct) newWins += 1;
      else newLosses += 1;
      setMessage(
        correct
          ? `Correct! ${next.label}${next.suit} was ${guess}. +€${bet}`
          : `Wrong. ${next.label}${next.suit} was not ${guess}. -€${bet}`
      );
    }

    const newTotalGuesses = totalGuesses + 1;

    setMoney(newMoney);
    setWins(newWins);
    setLosses(newLosses);
    setDeck(remaining);
    setIncoming(next);
    setPhase("compare");
    setTotalGuesses(newTotalGuesses);

    saveStats({
      money: newMoney,
      wins: newWins,
      losses: newLosses,
      total_guesses: newTotalGuesses,
    });

    // Hold both cards on screen so the player can compare them...
    setTimeout(() => {
      setPhase("settle"); // ...then fade the old one out...
      setTimeout(() => {
        setCurrent(next); // ...and promote the new card to "current".
        setIncoming(null);
        setPhase("idle");
      }, SETTLE_MS);
    }, REVEAL_MS);
  }

  function startNewGame() {
    resetLocalGame();
    if (user) {
      saveStats({ money: STARTING_MONEY, wins: 0, losses: 0, total_guesses: 0 });
    }
  }

  async function submitFeedback() {
    const trimmed = feedbackText.trim();
    if (!trimmed) return;
    setFeedbackError("");

    const { error } = await supabase.from("feedback").insert({
      user_id: user?.id ?? null,
      message: trimmed,
      game: feedbackGame,
    });

    if (error) {
      setFeedbackError("Couldn't send that — try again.");
      return;
    }

    setFeedbackSent(true);
    setFeedbackText("");
    setTimeout(() => {
      setFeedbackSent(false);
      setFeedbackOpen(false);
    }, 1500);
  }

  if (!current) return null;

  const bet = betForStage(stage);

  return (
    <div className="min-h-[640px] w-full flex items-center justify-center bg-emerald-950 p-6">
      <div className="w-full max-w-md rounded-3xl bg-emerald-900 border border-emerald-700/40 shadow-2xl p-8 flex flex-col items-center gap-5">
        <div className="text-center">
          <p className="text-emerald-300 text-xs tracking-wide uppercase mb-1">Higher or lower</p>
          <p className="font-serif text-4xl text-amber-300 tabular-nums">
            €{money.toLocaleString("en-IE")}
          </p>
          {!user && (
            <p className="text-[10px] text-emerald-400 mt-1">Log in to save your progress</p>
          )}
        </div>

        <div className="flex items-center gap-3 text-xs">
          <span className="px-3 py-1 rounded-full bg-emerald-800 text-emerald-100 border border-emerald-600/50">
            Stage {stage}
          </span>
          <span className="px-3 py-1 rounded-full bg-amber-500/90 text-emerald-950 font-medium">
            Bet €{bet}
          </span>
          <span className="text-emerald-300">
            {guessesInStage}/{GUESSES_PER_STAGE} this stage
          </span>
        </div>

        <div className="flex items-center gap-4 text-xs text-emerald-300">
          <span>
            Bets placed <span className="text-amber-300 font-medium">{totalGuesses}</span>
          </span>
          <span>
            Wins <span className="text-amber-300 font-medium">{wins}</span>
          </span>
          <span>
            Losses <span className="text-amber-300 font-medium">{losses}</span>
          </span>
        </div>

        {phase === "idle" ? (
          <div className="w-32 h-44">
            <Card card={current} />
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <div className="flex flex-col items-center gap-1">
              <span className="text-[10px] text-emerald-400 uppercase tracking-wide">Was</span>
              <div
                className={`w-28 h-40 transition-opacity duration-300 ${
                  phase === "settle" ? "opacity-0" : "opacity-100"
                }`}
              >
                <Card card={current} />
              </div>
            </div>
            <span className="text-emerald-500 text-lg">→</span>
            <div className="flex flex-col items-center gap-1">
              <span className="text-[10px] text-amber-300 uppercase tracking-wide">Now</span>
              <div className="w-28 h-40">
                <Card card={incoming} />
              </div>
            </div>
          </div>
        )}

        <p className="text-emerald-100 text-sm text-center min-h-[2.5em]">{message}</p>

        {!gameOver ? (
          <div className="flex gap-4 w-full">
            <button
              onClick={() => handleGuess("higher")}
              disabled={phase !== "idle" || !statsLoaded}
              className="flex-1 py-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-emerald-950 font-medium transition disabled:opacity-50"
            >
              ↑ Higher
            </button>
            <button
              onClick={() => handleGuess("lower")}
              disabled={phase !== "idle" || !statsLoaded}
              className="flex-1 py-3 rounded-xl bg-slate-700 hover:bg-slate-600 text-white font-medium transition disabled:opacity-50"
            >
              ↓ Lower
            </button>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3">
            <p className="text-rose-300 font-medium">Out of money. House wins this round.</p>
            <button
              onClick={startNewGame}
              className="px-6 py-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-emerald-950 font-medium transition"
            >
              Start over with €{STARTING_MONEY}
            </button>
          </div>
        )}

        <div className="w-full border-t border-emerald-700/40 pt-4">
          {!feedbackOpen ? (
            <button
              onClick={() => setFeedbackOpen(true)}
              className="text-xs text-emerald-300 hover:text-amber-300 transition underline underline-offset-2"
            >
              Got feedback? Tell us
            </button>
          ) : feedbackSent ? (
            <p className="text-xs text-amber-300">Thanks — feedback received.</p>
          ) : (
            <div className="flex flex-col gap-2">
              <select
                value={feedbackGame}
                onChange={(e) => setFeedbackGame(e.target.value)}
                className="w-full rounded-lg bg-emerald-800 border border-emerald-600/50 text-emerald-50 text-xs p-2 focus:outline-none focus:border-amber-400"
              >
                {GAMES.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.label}
                  </option>
                ))}
              </select>
              <textarea
                value={feedbackText}
                onChange={(e) => setFeedbackText(e.target.value.slice(0, FEEDBACK_LIMIT))}
                maxLength={FEEDBACK_LIMIT}
                rows={2}
                placeholder="What would make this better?"
                className="w-full resize-none rounded-lg bg-emerald-800 border border-emerald-600/50 text-emerald-50 text-xs p-2 placeholder:text-emerald-400 focus:outline-none focus:border-amber-400"
              />
              {feedbackError && <p className="text-[10px] text-rose-300">{feedbackError}</p>}
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-emerald-400">
                  {feedbackText.length}/{FEEDBACK_LIMIT}
                </span>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      setFeedbackOpen(false);
                      setFeedbackText("");
                      setFeedbackError("");
                    }}
                    className="text-xs text-emerald-400 hover:text-emerald-200 transition px-2"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={submitFeedback}
                    disabled={!feedbackText.trim()}
                    className="text-xs bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-emerald-950 font-medium px-3 py-1 rounded-lg transition"
                  >
                    Send
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
