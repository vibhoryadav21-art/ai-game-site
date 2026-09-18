'use client'

import { useLanguage } from '@/context/LanguageContext'

export default function AboutPage() {
  const { t } = useLanguage()
  const a = t.about

  return (
    <div className="flex-1 bg-black text-zinc-100 flex justify-center px-6 py-16">
      <div className="w-full max-w-2xl flex flex-col gap-8">
        <div className="flex flex-col gap-3 text-center">
          <h1 className="font-serif text-3xl text-sky-300">{a.title}</h1>
          <p className="text-zinc-400 leading-relaxed">{a.intro}</p>
        </div>

        <div className="flex flex-col gap-6">
          {a.sections.map((section, i) => (
            <div key={i} className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 flex flex-col gap-2">
              <h2 className="flex items-center gap-2 text-lg text-zinc-100">
                <span>{section.emoji}</span>
                <span>{section.heading}</span>
              </h2>
              <p className="text-zinc-400 text-sm leading-relaxed">{section.body}</p>
            </div>
          ))}
        </div>

        <p className="text-center text-zinc-500 text-sm">{a.footer}</p>
      </div>
    </div>
  )
}
