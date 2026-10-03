'use client'

import { useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { BOT_RISKS } from '@/lib/dohatti/engine'

export const RISK_ICON = { secure: '🛡', normal: '⚖', aggressive: '🔥' }

// "Bot style": how daring the AI players are. Everybody sees it, the host can change it.
export default function BotRisk({ room, isHost, t }) {
  const [error, setError] = useState('')
  const current = BOT_RISKS.includes(room.bot_risk) ? room.bot_risk : 'normal'
  const labels = { secure: t.riskSecure, normal: t.riskNormal, aggressive: t.riskAggressive }

  async function choose(value) {
    if (!isHost || value === current) return
    setError('')
    const { error: updateError } = await supabase.from('dohatti_rooms').update({ bot_risk: value }).eq('id', room.id)
    if (updateError) setError(updateError.message)
  }

  return (
    <div className="w-full flex flex-col items-center gap-1.5">
      <span className="text-sm text-zinc-400">🤖 {t.botStyleTitle}</span>
      <div className="w-full grid grid-cols-3 gap-1.5">
        {BOT_RISKS.map((value) => (
          <button
            key={value}
            onClick={() => choose(value)}
            disabled={!isHost}
            aria-pressed={value === current}
            className={`rounded-lg border-2 py-2 text-sm font-semibold transition active:scale-95 ${
              value === current
                ? 'border-emerald-400 bg-emerald-900/60 text-emerald-100'
                : 'border-zinc-700 bg-zinc-900 text-zinc-300'
            } ${isHost ? '' : 'opacity-70'}`}
          >
            {RISK_ICON[value]} {labels[value]}
          </button>
        ))}
      </div>
      {!isHost && <span className="text-xs text-zinc-500 text-center">{t.riskHostOnly}</span>}
      {error && <span className="text-xs text-red-400 text-center">{error}</span>}
    </div>
  )
}
