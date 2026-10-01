import { SUIT_SYMBOL, suitOf, rankOf } from '@/lib/dohatti/engine'

const RANK_LABEL = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' }

export default function PlayingCard({ card, faceDown = false, onClick, disabled = false, dim = false }) {
  if (faceDown || !card) {
    return <div className="w-10 h-14 rounded-md border border-sky-700 bg-sky-900" />
  }

  const suit = suitOf(card)
  const rank = rankOf(card)
  const label = RANK_LABEL[rank] || String(rank)
  const red = suit === 'H' || suit === 'D'
  const color = red ? 'text-red-600' : 'text-zinc-900'

  const base = `w-12 h-16 rounded-md border bg-white flex flex-col items-center justify-center leading-none font-semibold ${color}`
  const state = dim ? 'opacity-60' : ''

  if (onClick) {
    return (
      <button
        onClick={onClick}
        disabled={disabled}
        className={`${base} ${state} border-zinc-300 transition ${
          disabled ? 'opacity-40 cursor-not-allowed' : 'hover:-translate-y-2 hover:border-emerald-400 cursor-pointer'
        }`}
      >
        <span className="text-base">{label}</span>
        <span className="text-xl">{SUIT_SYMBOL[suit]}</span>
      </button>
    )
  }

  return (
    <div className={`${base} ${state} border-zinc-300`}>
      <span className="text-base">{label}</span>
      <span className="text-xl">{SUIT_SYMBOL[suit]}</span>
    </div>
  )
}
