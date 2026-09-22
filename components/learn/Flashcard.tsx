"use client";

import { useState } from "react";
import { LearnItem } from "@/lib/learn/types";

export default function Flashcard({
  items,
}: {
  items: LearnItem[];
}) {
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);

  if (items.length === 0) return null;
  const item = items[index];

  function next() {
    setFlipped(false);
    setIndex((i) => (i + 1) % items.length);
  }

  function prev() {
    setFlipped(false);
    setIndex((i) => (i - 1 + items.length) % items.length);
  }

  return (
    <div className="flex flex-col items-center gap-4">
      <p className="text-sm text-gray-500">
        {index + 1} / {items.length}
      </p>

      <div
        onClick={() => setFlipped((f) => !f)}
        className="w-full max-w-sm h-56 rounded-2xl shadow-lg border cursor-pointer
                   flex flex-col items-center justify-center gap-2 p-6 text-center
                   bg-white hover:shadow-xl transition-shadow"
      >
        {!flipped ? (
          <>
            <span className="text-4xl font-bold">{item.native}</span>
            <span className="text-lg text-gray-500 italic">{item.roman}</span>
            <span className="text-xs text-gray-400 mt-2">(tap to reveal meaning)</span>
          </>
        ) : (
          <span className="text-2xl font-semibold text-blue-600">
            {item.english}
          </span>
        )}
      </div>

      <div className="flex gap-3">
        <button
          onClick={prev}
          className="px-4 py-2 rounded-lg border hover:bg-gray-100"
        >
          ← Prev
        </button>
        <button
          onClick={next}
          className="px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700"
        >
          Next →
        </button>
      </div>
    </div>
  );
}