import Link from "next/link";

export default function LearnHubPage() {
  return (
    <div className="max-w-2xl mx-auto p-6 space-y-6">
      <h1 className="text-3xl font-bold text-center">Choose a language</h1>
      <div className="flex justify-center gap-4">
        <Link
          href="/learn/hindi"
          className="px-6 py-4 rounded-xl border shadow hover:shadow-md text-lg"
        >
          🇮🇳 Hindi
        </Link>
        <Link
          href="/learn/spanish"
          className="px-6 py-4 rounded-xl border shadow hover:shadow-md text-lg"
        >
          🇪🇸 Spanish
        </Link>
      </div>
    </div>
  );
}