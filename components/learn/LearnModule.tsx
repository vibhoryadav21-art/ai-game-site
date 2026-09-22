"use client";

import { useState } from "react";
import { LanguageCourse } from "@/lib/learn/types";
import Flashcard from "./Flashcard";
import QuizMCQ from "./QuizMCQ";

export default function LearnModule({ course }: { course: LanguageCourse }) {
  const [categoryId, setCategoryId] = useState(course.categories[0].id);
  const [mode, setMode] = useState<"flashcards" | "quiz">("flashcards");

  const category = course.categories.find((c) => c.id === categoryId)!;

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-8">
      <div className="text-center space-y-1">
        <h1 className="text-3xl font-bold">
          {course.flag} Learn {course.name}
        </h1>
        <p className="text-gray-500">Level: A1 (Beginner)</p>
      </div>

      {/* Category picker */}
      <div className="flex flex-wrap justify-center gap-2">
        {course.categories.map((c) => (
          <button
            key={c.id}
            onClick={() => setCategoryId(c.id)}
            className={`px-3 py-1.5 rounded-full text-sm border ${
              c.id === categoryId
                ? "bg-blue-600 text-white border-blue-600"
                : "hover:bg-gray-100"
            }`}
          >
            {c.title}
          </button>
        ))}
      </div>

      {/* Mode toggle */}
      <div className="flex justify-center gap-2">
        <button
          onClick={() => setMode("flashcards")}
          className={`px-4 py-1.5 rounded-lg text-sm ${
            mode === "flashcards" ? "bg-gray-900 text-white" : "border"
          }`}
        >
          Flashcards
        </button>
        <button
          onClick={() => setMode("quiz")}
          className={`px-4 py-1.5 rounded-lg text-sm ${
            mode === "quiz" ? "bg-gray-900 text-white" : "border"
          }`}
        >
          Quiz
        </button>
      </div>

      {/* Content, remounts on category/mode change via key */}
      <div key={`${categoryId}-${mode}`}>
        {mode === "flashcards" ? (
          <Flashcard items={category.items} />
        ) : (
          <QuizMCQ items={category.items} />
        )}
      </div>
    </div>
  );
}