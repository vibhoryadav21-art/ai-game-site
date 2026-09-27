import fs from "fs";
import path from "path";
import Image from "next/image";

// This route is statically rendered at build time using whatever is
// currently committed in data/thod.json + public/thod/*.
// To change the Thought of the Day: edit data/thod.json, replace the
// image in public/thod/, commit, and push. Vercel redeploys automatically.

interface Thod {
  date: string;
  image: string;
  thought: string;
}

function getThod(): Thod {
  const filePath = path.join(process.cwd(), "data", "thod.json");
  const raw = fs.readFileSync(filePath, "utf-8");
  return JSON.parse(raw);
}

export const metadata = {
  title: "Thought of the Day",
};

export default function ThodPage() {
  const thod = getThod();
  const formattedDate = new Date(thod.date).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <main className="min-h-screen bg-black text-white flex flex-col items-center px-4 py-16">
      <h1 className="text-3xl md:text-4xl font-bold tracking-tight mb-2">
        Thought of the Day
      </h1>
      <p className="text-sm text-gray-400 mb-10">{formattedDate}</p>

      <div className="w-full max-w-xl rounded-2xl overflow-hidden border border-white/10 bg-white/5 shadow-lg">
        <div className="relative w-full aspect-square bg-white/5">
          <Image
            src={thod.image}
            alt="Thought of the Day"
            fill
            className="object-cover"
            priority
          />
        </div>
        <div className="p-6">
          <p className="text-lg leading-relaxed text-gray-100">
            {thod.thought}
          </p>
        </div>
      </div>
    </main>
  );
}
