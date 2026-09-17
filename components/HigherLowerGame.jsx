import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useLanguage } from "@/context/LanguageContext";

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
  const { t } = useLanguage();
  const [deck, setDeck] = useState([]);
  const [current, setCurrent] = useState(null);
  const [incoming, setIncoming] = useState(null);
  // phase: 'idle' (one card showing) -> 'compare' (both visible) -> 'settle' (old fading out)
  const [phase, setPhase] = useState("idle");
  const [money, setMoney] = useState(STARTING_MONEY);
  const [totalGuesses, setTotalGuesses] = useState(0);
  const stage = Math.floor(totalGuesses / GUESSES_PER_STAGE) + 1;
  const guessesInStage = totalGuesses % GUESSES_PER_STAGE;
  const [message, setMessage] = useState(t.game.callIt);
  const [wins, setWins] = useState(0);
  const [losses, setLosses] = useState(0);
  const [gameOver, setGameOver] = useState(false);
  const [currentRunPeak, setCurrentRunPeak] = useState(STARTING_MONEY);
  const [lastScore, setLastScore] = useState(0);
  const [highScore, setHighScore] = useState(0);
  const [gamesPlayed, setGamesPlayed] = useState(0);

  // --- Account / saved-progress state ---
  const [user, setUser] = useState(null);
  const [anonId, setAnonId] = useState(null);
  const [statsLoaded, setStatsLoaded] = useState(false);

  // Whichever identity we currently have — a logged-in user takes priority,
  // otherwise we fall back to this browser's anonymous id.
  const identity = user
    ? { column: "user_id", value: user.id }
    : anonId
    ? { column: "anon_id", value: anonId }
    : null;

  function resetLocalGame() {
    const fresh = shuffle(buildDeck());
    setCurrent(fresh[0]);
    setIncoming(null);
    setPhase("idle");
    setDeck(fresh.slice(1));
    setMoney(STARTING_MONEY);
    setCurrentRunPeak(STARTING_MONEY);
    setTotalGuesses(0);
    setWins(0);
    setLosses(0);
    setMessage(t.game.callIt);
    setGameOver(false);
  }

  // Deal the very first card once, on mount.
  useEffect(() => {
    resetLocalGame();
  }, []);

  // Guests get a random id the first time they visit, saved in this browser
  // so repeat visits (from the same browser) accumulate under the same row.
  useEffect(() => {
    let id = window.localStorage.getItem("anon_id");
    if (!id) {
      id = crypto.randomUUID();
      window.localStorage.setItem("anon_id", id);
    }
    setAnonId(id);
  }, []);

  // Load this identity's saved stats (or create their row the first time),
  // and keep listening in case they log in/out while on this page.
  useEffect(() => {
    if (!identity) return;
    let active = true;

    async function loadOrCreateStats() {
      const { data, error } = await supabase
        .from("game_stats")
        .select("*")
        .eq(identity.column, identity.value)
        .maybeSingle();

      if (!active) return;

      if (error) {
        console.error("Failed to load game stats:", error.message);
      } else if (data) {
        setMoney(data.money);
        setWins(data.wins);
        setLosses(data.losses);
        setTotalGuesses(data.total_guesses);
        setCurrentRunPeak(data.current_run_peak);
        setLastScore(data.last_score);
        setHighScore(data.high_score);
        setGamesPlayed(data.games_played);
        setGameOver(data.money <= 0);
      } else {
        // First time this identity has played — create their row.
        await supabase.from("game_stats").insert({
          [identity.column]: identity.value,
          money: STARTING_MONEY,
          wins: 0,
          losses: 0,
          total_guesses: 0,
          current_run_peak: STARTING_MONEY,
          last_score: 0,
          high_score: 0,
          games_played: 0,
        });
      }
      setStatsLoaded(true);
    }

    setStatsLoaded(false);
    loadOrCreateStats();

    return () => {
      active = false;
    };
  }, [identity?.column, identity?.value]);

  // Watch for login/logout so we switch from the anon row to the user's
  // row (or back) without needing a page refresh.
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  // Persist stats to Supabase for whichever identity is currently active.
  async function saveStats(fields) {
    if (!identity) return;
    const { error } = await supabase.from("game_stats").upsert(
      { [identity.column]: identity.value, ...fields, updated_at: new Date().toISOString() },
      { onConflict: identity.column }
    );
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
      setMessage(t.game.push(current.label));
    } else {
      const correct =
        (guess === "higher" && next.value > current.value) ||
        (guess === "lower" && next.value < current.value);
      newMoney = correct ? money + bet : money - bet;
      if (correct) newWins += 1;
      else newLosses += 1;
      const guessWord = guess === "higher" ? t.game.higher : t.game.lower;
      setMessage(
        correct
          ? t.game.correct(next.label, next.suit, guessWord, bet)
          : t.game.wrong(next.label, next.suit, guessWord, bet)
      );
    }

    const newTotalGuesses = totalGuesses + 1;
    const newPeak = Math.max(currentRunPeak, newMoney);
    const busted = newMoney <= 0;

    // A "score" is the highest balance reached during a run, locked in the
    // moment that run ends (goes bust). Still-in-progress runs don't touch
    // last/high score yet — only completed ones do.
    const newLastScore = busted ? newPeak : lastScore;
    const newHighScore = busted ? Math.max(highScore, newPeak) : highScore;
    const newGamesPlayed = busted ? gamesPlayed + 1 : gamesPlayed;
    const nextPeak = busted ? STARTING_MONEY : newPeak;

    setMoney(newMoney);
    setWins(newWins);
    setLosses(newLosses);
    setDeck(remaining);
    setIncoming(next);
    setPhase("compare");
    setTotalGuesses(newTotalGuesses);
    setCurrentRunPeak(nextPeak);
    setLastScore(newLastScore);
    setHighScore(newHighScore);
    setGamesPlayed(newGamesPlayed);

    saveStats({
      money: newMoney,
      wins: newWins,
      losses: newLosses,
      total_guesses: newTotalGuesses,
      current_run_peak: nextPeak,
      last_score: newLastScore,
      high_score: newHighScore,
      games_played: newGamesPlayed,
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
    if (identity) {
      saveStats({
        money: STARTING_MONEY,
        wins: 0,
        losses: 0,
        total_guesses: 0,
        current_run_peak: STARTING_MONEY,
      });
    }
  }

  if (!current) return null;

  const bet = betForStage(stage);

  return (
    <div className="min-h-[640px] w-full flex items-center justify-center bg-emerald-950 p-6">
      <div className="w-full max-w-md rounded-3xl bg-emerald-900 border border-emerald-700/40 shadow-2xl p-8 flex flex-col items-center gap-5">
        <div className="text-center">
          <p className="text-emerald-300 text-xs tracking-wide uppercase mb-1">{t.game.title}</p>
          <p className="font-serif text-4xl text-amber-300 tabular-nums">
            €{money.toLocaleString("en-IE")}
          </p>
          {!user && (
            <p className="text-[10px] text-emerald-400 mt-1">{t.game.loginToSave}</p>
          )}
        </div>

        <div className="flex items-center gap-3 text-xs">
          <span className="px-3 py-1 rounded-full bg-emerald-800 text-emerald-100 border border-emerald-600/50">
            {t.game.stage} {stage}
          </span>
          <span className="px-3 py-1 rounded-full bg-amber-500/90 text-emerald-950 font-medium">
            {t.game.bet} €{bet}
          </span>
          <span className="text-emerald-300">
            {guessesInStage}/{GUESSES_PER_STAGE} {t.game.thisStage}
          </span>
        </div>

        <div className="flex items-center gap-4 text-xs text-emerald-300">
          <span>
            {t.game.betsPlaced} <span className="text-amber-300 font-medium">{totalGuesses}</span>
          </span>
          <span>
            {t.game.wins} <span className="text-amber-300 font-medium">{wins}</span>
          </span>
          <span>
            {t.game.losses} <span className="text-amber-300 font-medium">{losses}</span>
          </span>
        </div>

        {user && (
          <div className="flex items-center gap-4 text-xs text-emerald-300">
            <span>
              {t.game.lastScore} <span className="text-amber-300 font-medium">€{lastScore}</span>
            </span>
            <span>
              {t.game.highScore} <span className="text-amber-300 font-medium">€{highScore}</span>
            </span>
            <span>
              {t.game.gamesPlayed} <span className="text-amber-300 font-medium">{gamesPlayed}</span>
            </span>
          </div>
        )}

        {phase === "idle" ? (
          <div className="w-32 h-44">
            <Card card={current} />
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <div className="flex flex-col items-center gap-1">
              <span className="text-[10px] text-emerald-400 uppercase tracking-wide">{t.game.was}</span>
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
              <span className="text-[10px] text-amber-300 uppercase tracking-wide">{t.game.now}</span>
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
              ↑ {t.game.higher}
            </button>
            <button
              onClick={() => handleGuess("lower")}
              disabled={phase !== "idle" || !statsLoaded}
              className="flex-1 py-3 rounded-xl bg-slate-700 hover:bg-slate-600 text-white font-medium transition disabled:opacity-50"
            >
              ↓ {t.game.lower}
            </button>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3">
            <p className="text-rose-300 font-medium">{t.game.outOfMoney}</p>
            <button
              onClick={startNewGame}
              className="px-6 py-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-emerald-950 font-medium transition"
            >
              {t.game.startOver(STARTING_MONEY)}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
