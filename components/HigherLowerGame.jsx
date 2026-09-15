import { useState, useEffect, useCallback } from "react";

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
const CHIPS = [10, 25, 50, 100];

export default function HigherLowerGame() {
  const [deck, setDeck] = useState([]);
  const [current, setCurrent] = useState(null);
  const [money, setMoney] = useState(STARTING_MONEY);
  const [bet, setBet] = useState(50);
  const [message, setMessage] = useState("Place your bet, then call it.");
  const [gameOver, setGameOver] = useState(false);
  const [revealing, setRevealing] = useState(false);

  const startNewGame = useCallback(() => {
    const fresh = shuffle(buildDeck());
    setCurrent(fresh[0]);
    setDeck(fresh.slice(1));
    setMoney(STARTING_MONEY);
    setBet(50);
    setMessage("Place your bet, then call it.");
    setGameOver(false);
  }, []);

  useEffect(() => {
    startNewGame();
  }, [startNewGame]);

  useEffect(() => {
    if (money <= 0) setGameOver(true);
  }, [money]);

  function drawNext(deckToUse) {
    if (deckToUse.length < 1) {
      const reshuffled = shuffle(buildDeck());
      return { next: reshuffled[0], remaining: reshuffled.slice(1) };
    }
    return { next: deckToUse[0], remaining: deckToUse.slice(1) };
  }

  function handleGuess(guess) {
    if (gameOver || revealing || !current) return;
    const safeBet = Math.min(bet, money);
    const { next, remaining } = drawNext(deck);

    setRevealing(true);
    setTimeout(() => {
      if (next.value === current.value) {
        setMessage(`Push — both ${current.label}s. Your bet is safe.`);
      } else {
        const correct =
          (guess === "higher" && next.value > current.value) ||
          (guess === "lower" && next.value < current.value);
        setMoney((m) => (correct ? m + safeBet : m - safeBet));
        setMessage(
          correct
            ? `Correct! ${next.label}${next.suit} was ${guess}. +€${safeBet}`
            : `Wrong. ${next.label}${next.suit} was not ${guess}. -€${safeBet}`
        );
      }
      setCurrent(next);
      setDeck(remaining);
      setRevealing(false);
    }, 450);
  }

  if (!current) return null;

  return (
    <div className="min-h-[600px] w-full flex items-center justify-center bg-emerald-950 p-6">
      <div className="w-full max-w-md rounded-3xl bg-emerald-900 border border-emerald-700/40 shadow-2xl p-8 flex flex-col items-center gap-6">
        <div className="text-center">
          <p className="text-emerald-300 text-xs tracking-wide uppercase mb-1">Higher or lower</p>
          <p className="font-serif text-4xl text-amber-300 tabular-nums">
            €{money.toLocaleString("en-IE")}
          </p>
        </div>

        <div
          className={`w-32 h-44 rounded-xl bg-white shadow-lg flex flex-col items-center justify-center transition-transform duration-300 ${
            revealing ? "scale-95 opacity-60" : "scale-100 opacity-100"
          }`}
        >
          <span className={`text-4xl font-semibold ${current.color}`}>{current.label}</span>
          <span className={`text-4xl ${current.color}`}>{current.suit}</span>
        </div>

        <p className="text-emerald-100 text-sm text-center min-h-[2.5em]">{message}</p>

        {!gameOver ? (
          <>
            <div className="flex gap-2 flex-wrap justify-center">
              {CHIPS.map((c) => (
                <button
                  key={c}
                  onClick={() => setBet(Math.min(c, money))}
                  disabled={revealing}
                  className={`w-12 h-12 rounded-full border-2 text-xs font-medium flex items-center justify-center transition ${
                    bet === c
                      ? "border-amber-400 bg-amber-500 text-emerald-950"
                      : "border-emerald-600 bg-emerald-800 text-emerald-100 hover:border-amber-400"
                  } disabled:opacity-40`}
                >
                  €{c}
                </button>
              ))}
              <button
                onClick={() => setBet(money)}
                disabled={revealing}
                className={`w-12 h-12 rounded-full border-2 text-[10px] font-medium flex items-center justify-center transition ${
                  bet === money
                    ? "border-rose-400 bg-rose-600 text-white"
                    : "border-rose-700 bg-emerald-800 text-rose-300 hover:border-rose-400"
                } disabled:opacity-40`}
              >
                ALL IN
              </button>
            </div>

            <p className="text-emerald-300 text-xs">
              Betting <span className="text-amber-300 font-medium">€{Math.min(bet, money)}</span>
            </p>

            <div className="flex gap-4 w-full">
              <button
                onClick={() => handleGuess("higher")}
                disabled={revealing}
                className="flex-1 py-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-emerald-950 font-medium transition disabled:opacity-50"
              >
                ↑ Higher
              </button>
              <button
                onClick={() => handleGuess("lower")}
                disabled={revealing}
                className="flex-1 py-3 rounded-xl bg-slate-700 hover:bg-slate-600 text-white font-medium transition disabled:opacity-50"
              >
                ↓ Lower
              </button>
            </div>
          </>
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
      </div>
    </div>
  );
}
