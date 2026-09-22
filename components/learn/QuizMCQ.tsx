"use client";

import { useMemo, useState } from "react";
import { LearnItem } from "@/lib/learn/types";

function shuffle<T>(arr: T[]): T[] {
  return [...arr].sort(() => Math.random() - 0.5);
}

function buildQuestions(items: LearnItem[]) {
  return shuffle(items).map((item) => {
    const wrongPool = items.filter((i) => i.id !== item.id);
    const distractors = shuffle(wrongPool).slice(0, 3).map((i) => i.english);
    const options = shuffle([item.english, ...distractors]);
    return { item, options };
  });
}

export default function QuizMCQ({ items }: { items: LearnItem[] }) {
  const questions = useMemo(() => buildQuestions(items), [items]);
  const [qIndex, setQIndex] = useState(0);
  const [score, setScore] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (items.length < 4) {
    return (
      <p className="text-gray-500">
        Need at least 4 items in this category for a quiz.
      </p>
    );
  }

  if (done) {
    return (
      <div className="text-center space-y-4">
        <p className="text-2xl font-bold">
          Score: {score} / {questions.length}
        </p>
        <button
          onClick={() => {
            setQIndex(0);
            setScore(0);
            setSelected(null);
            setDone(false);
          }}
          className="px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700"
        >
          Try Again
        </button>
      </div>
    );
  }

  const q = questions[qIndex];

  function choose(option: string) {
    if (selected) return; // lock after first choice
    setSelected(option);
    if (option === q.item.english) setScore((s) => s + 1);
  }

  function next() {
    setSelected(null);
    if (qIndex + 1 >= questions.length) {
      setDone(true);
    } else {
      setQIndex((i) => i + 1);
    }
  }

  return (
    <div className="flex flex-col items-center gap-5 max-w-sm mx-auto">
      <p className="text-sm text-gray-500">
        Question {qIndex + 1} / {questions.length}
      </p>

      <div className="text-center">
        <p className="text-3xl font-bold">{q.item.native}</p>
        <p className="text-lg text-gray-500 italic">{q.item.roman}</p>
        <p className="text-sm text-gray-400 mt-1">What does this mean?</p>
      </div>

      <div className="w-full flex flex-col gap-2">
        {q.options.map((opt) => {
          const isCorrect = opt === q.item.english;
          const showState = selected !== null;
          let style = "border hover:bg-gray-100";
          if (showState && opt === selected && isCorrect) style = "border-green-500 bg-green-100";
          if (showState && opt === selected && !isCorrect) style = "border-red-500 bg-red-100";
          if (showState && opt !== selected && isCorrect) style = "border-green-500 bg-green-50";

          return (
            <button
              key={opt}
              onClick={() => choose(opt)}
              className={`px-4 py-2 rounded-lg text-left ${style}`}
            >
              {opt}
            </button>
          );
        })}
      </div>

      {selected && (
        <button
          onClick={next}
          className="px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700"
        >
          {qIndex + 1 >= questions.length ? "See Score" : "Next Question →"}
        </button>
      )}
    </div>
  );
}