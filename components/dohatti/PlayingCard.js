import { SUIT_SYMBOL, suitOf, rankOf } from '@/lib/dohatti/engine'

const RANK_LABEL = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' }

// size "md" = cards in your hand, "sm" = cards on the table
export default function PlayingCard({
  card,
  faceDown = false,
  onClick,
  disabled = false,
  selected = false,
  dim = false,
  size = 'md',
}) {
  const dims = size === 'sm' ? 'w-10 h-14' : 'w-12 h-[4.5rem]'
  const rankText = size === 'sm' ? 'text-sm' : 'text-lg'
  const suitText = size === 'sm' ? 'text-xl' : 'text-3xl'

  if (faceDown || !card) {
    return <div className={`${dims} rounded-md border border-sky-700 bg-sky-900`} />
  }

  const suit = suitOf(card)
  const label = RANK_LABEL[rankOf(card)] || String(rankOf(card))
  const color = suit === 'H' || suit === 'D' ? 'text-red-600' : 'text-zinc-900'
  const base = `${dims} rounded-md border bg-white flex flex-col items-center justify-center leading-none font-semibold ${color} ${
    dim ? 'opacity-70' : ''
  }`

  const face = (
    <>
      <span className={rankText}>{label}</span>
      <span className={suitText}>{SUIT_SYMBOL[suit]}</span>
    </>
  )

  if (onClick) {
    return (
      <button
        onClick={onClick}
        disabled={disabled}
        className={`${base} transition ${
          selected ? '-translate-y-2 border-emerald-400 ring-2 ring-emerald-400' : 'border-zinc-300'
        } ${disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer active:scale-95'}`}
      >
        {face}
      </button>
    )
  }

  return <div className={`${base} border-zinc-300`}>{face}</div>
}
