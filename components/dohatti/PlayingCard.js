import { SUIT_SYMBOL, suitOf, rankOf } from '@/lib/dohatti/engine'

const RANK_LABEL = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' }

// "md" = cards in your hand (7 fit in a row on a phone), "sm" = cards on the table,
// "xs" = the trump card in the top bar
const SIZES = {
  md: { box: 'w-10 h-14', rank: 'text-sm', suit: 'text-xl' },
  sm: { box: 'w-8 h-11', rank: 'text-xs', suit: 'text-base' },
  xs: { box: 'w-7 h-10', rank: 'text-[10px]', suit: 'text-sm' },
}

export default function PlayingCard({
  card,
  faceDown = false,
  onClick,
  disabled = false,
  selected = false,
  dim = false,
  size = 'md',
}) {
  const { box, rank: rankText, suit: suitText } = SIZES[size] || SIZES.md

  if (faceDown || !card) {
    return <div className={`${box} rounded-md border border-sky-700 bg-sky-900 shrink-0`} />
  }

  const suit = suitOf(card)
  const label = RANK_LABEL[rankOf(card)] || String(rankOf(card))
  const color = suit === 'H' || suit === 'D' ? 'text-red-600' : 'text-zinc-900'
  const base = `${box} shrink-0 rounded-md border bg-white flex flex-col items-center justify-center leading-none font-semibold ${color} ${
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
