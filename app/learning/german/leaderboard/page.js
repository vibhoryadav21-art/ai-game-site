'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabaseClient'

const BADGES = [
  { min: 0, name: 'Beginner' },
  { min: 30, name: 'Challenger' },
  { min: 60, name: 'Advanced' },
  { min: 90, name: 'Pro' },
  { min: 120, name: 'QuizMaster' },
]
const MAX_CREWS = 5

function getBadge(score) {
  let badge = BADGES[0].name
  for (const tier of BADGES) {
    if (score >= tier.min) badge = tier.name
  }
  return badge
}

export default function GermanLeaderboardPage() {
  const [checked, setChecked] = useState(false)
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  const [myCrews, setMyCrews] = useState([]) // crews I'm an accepted member of
  const [pendingCrews, setPendingCrews] = useState([]) // crews I've requested, awaiting approval
  const [browseCrews, setBrowseCrews] = useState([]) // crews I could still request to join
  const [adminRequests, setAdminRequests] = useState([]) // pending requests for crews I admin

  const [selectedCrewId, setSelectedCrewId] = useState('')
  const [rows, setRows] = useState([])
  const [newCrewName, setNewCrewName] = useState('')
  const [formError, setFormError] = useState('')

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null)
      setChecked(true)
    })
  }, [])

  const loadCrewData = useCallback(async (userId) => {
    setLoading(true)

    const [{ data: allCrews }, { data: myMemberships }, { data: myStats }] = await Promise.all([
      supabase.from('crews').select('*'),
      supabase.from('crew_members').select('*').eq('user_id', userId),
      supabase.from('german_stats').select('default_crew_id').eq('user_id', userId).single(),
    ])

    const memberOf = (myMemberships || []).filter((m) => m.status === 'member')
    const pendingOf = (myMemberships || []).filter((m) => m.status === 'pending')
    const myCrewIds = new Set(memberOf.map((m) => m.crew_id))
    const pendingCrewIds = new Set(pendingOf.map((m) => m.crew_id))

    const crewMap = Object.fromEntries((allCrews || []).map((c) => [c.id, c]))

    setMyCrews(memberOf.map((m) => crewMap[m.crew_id]).filter(Boolean))
    setPendingCrews(pendingOf.map((m) => crewMap[m.crew_id]).filter(Boolean))
    setBrowseCrews(
      (allCrews || []).filter((c) => !myCrewIds.has(c.id) && !pendingCrewIds.has(c.id))
    )

    const savedDefault = myStats?.default_crew_id
    if (savedDefault && myCrewIds.has(savedDefault)) {
      setSelectedCrewId(savedDefault)
    }

    // Pending requests for crews I admin.
    const myAdminCrewIds = (allCrews || []).filter((c) => c.admin_id === userId).map((c) => c.id)
    if (myAdminCrewIds.length > 0) {
      const { data: requests } = await supabase
        .from('crew_members')
        .select('*')
        .in('crew_id', myAdminCrewIds)
        .eq('status', 'pending')

      if (requests && requests.length > 0) {
        const requesterIds = requests.map((r) => r.user_id)
        const { data: people } = await supabase
          .from('german_stats')
          .select('user_id, display_name')
          .in('user_id', requesterIds)
        const nameMap = Object.fromEntries((people || []).map((p) => [p.user_id, p.display_name]))
        setAdminRequests(
          requests.map((r) => ({
            ...r,
            crewName: crewMap[r.crew_id]?.name || 'Unknown crew',
            requesterName: nameMap[r.user_id] || 'Someone',
          }))
        )
      } else {
        setAdminRequests([])
      }
    } else {
      setAdminRequests([])
    }

    setLoading(false)
  }, [])

  useEffect(() => {
    if (checked && user) loadCrewData(user.id)
  }, [checked, user, loadCrewData])

  const loadLeaderboardForCrew = useCallback(async (crewId) => {
    if (!crewId) {
      setRows([])
      return
    }
    const { data: members } = await supabase
      .from('crew_members')
      .select('user_id')
      .eq('crew_id', crewId)
      .eq('status', 'member')

    const userIds = (members || []).map((m) => m.user_id)
    if (userIds.length === 0) {
      setRows([])
      return
    }

    const { data: stats } = await supabase
      .from('german_stats')
      .select('user_id, display_name, score, total_answered, total_correct')
      .in('user_id', userIds)

    const ranked = (stats || [])
      .filter((r) => r.total_answered > 0)
      .map((r) => ({
        ...r,
        score: r.score || 0,
        accuracy: r.total_answered > 0 ? r.total_correct / r.total_answered : 0,
      }))
      .sort((a, b) => b.score - a.score || b.accuracy - a.accuracy)

    setRows(ranked)
  }, [])

  useEffect(() => {
    loadLeaderboardForCrew(selectedCrewId)
  }, [selectedCrewId, loadLeaderboardForCrew])

  async function selectCrew(crewId) {
    setSelectedCrewId(crewId)
    await supabase
      .from('german_stats')
      .update({ default_crew_id: crewId || null })
      .eq('user_id', user.id)
  }

  async function createCrew() {
    setFormError('')
    const name = newCrewName.trim()
    if (!name) return
    if (myCrews.length >= MAX_CREWS) {
      setFormError(`You're already in ${MAX_CREWS} crews — leave one first.`)
      return
    }

    const { data: crew, error } = await supabase
      .from('crews')
      .insert({ name, admin_id: user.id })
      .select()
      .single()

    if (error) {
      setFormError(error.code === '23505' ? 'That crew name is taken.' : "Couldn't create that crew.")
      return
    }

    await supabase
      .from('crew_members')
      .insert({ crew_id: crew.id, user_id: user.id, status: 'member', decided_at: new Date().toISOString() })

    await supabase.from('german_stats').update({ default_crew_id: crew.id }).eq('user_id', user.id)
    setSelectedCrewId(crew.id)

    setNewCrewName('')
    loadCrewData(user.id)
  }

  async function requestJoin(crewId) {
    setFormError('')
    if (myCrews.length >= MAX_CREWS) {
      setFormError(`You're already in ${MAX_CREWS} crews — leave one first.`)
      return
    }
    const { error } = await supabase
      .from('crew_members')
      .insert({ crew_id: crewId, user_id: user.id, status: 'pending' })
    if (!error) loadCrewData(user.id)
  }

  async function respondToRequest(requestRowId, accept) {
    if (accept) {
      await supabase
        .from('crew_members')
        .update({ status: 'member', decided_at: new Date().toISOString() })
        .eq('id', requestRowId)
    } else {
      await supabase.from('crew_members').delete().eq('id', requestRowId)
    }
    loadCrewData(user.id)
  }

  if (!checked || loading) {
    return (
      <div className="flex-1 bg-zinc-950 text-zinc-100 flex items-center justify-center">
        <p className="text-zinc-400">Loading…</p>
      </div>
    )
  }

  if (!user) {
    return (
      <div className="flex-1 bg-zinc-950 text-zinc-100 flex items-center justify-center">
        <p className="text-zinc-300">Log in to see crews and leaderboards.</p>
      </div>
    )
  }

  return (
    <div className="flex-1 bg-zinc-950 text-zinc-100 flex flex-col items-center gap-6 p-6">
      <div className="w-full max-w-lg flex items-center justify-between">
        <h1 className="font-serif text-2xl text-sky-300">Crews</h1>
        <Link href="/learning/german" className="text-xs text-zinc-400 hover:text-sky-300 transition">
          Back to practice
        </Link>
      </div>

      {adminRequests.length > 0 && (
        <div className="w-full max-w-lg bg-zinc-900 border border-zinc-700 rounded-xl p-4 flex flex-col gap-2">
          <p className="text-xs text-zinc-500 uppercase tracking-wide">Requests to approve</p>
          {adminRequests.map((r) => (
            <div key={r.id} className="flex items-center justify-between text-sm">
              <span>
                {r.requesterName} wants to join <span className="text-sky-300">{r.crewName}</span>
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => respondToRequest(r.id, true)}
                  className="text-xs bg-emerald-700 hover:bg-emerald-600 px-2 py-1 rounded-lg transition"
                >
                  Accept
                </button>
                <button
                  onClick={() => respondToRequest(r.id, false)}
                  className="text-xs bg-rose-900 hover:bg-rose-800 px-2 py-1 rounded-lg transition"
                >
                  Deny
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="w-full max-w-lg bg-zinc-900 border border-zinc-700 rounded-xl p-4 flex flex-col gap-3">
        <p className="text-xs text-zinc-500 uppercase tracking-wide">
          Your crews ({myCrews.length}/{MAX_CREWS})
        </p>

        {myCrews.length === 0 ? (
          <p className="text-sm text-zinc-500">You're not in any crew yet.</p>
        ) : (
          <select
            value={selectedCrewId}
            onChange={(e) => selectCrew(e.target.value)}
            className="bg-zinc-800 border border-zinc-600 text-zinc-100 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-sky-400"
          >
            <option value="">Select a crew to view its leaderboard…</option>
            {myCrews.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}

        {pendingCrews.length > 0 && (
          <p className="text-xs text-zinc-500">
            Pending approval: {pendingCrews.map((c) => c.name).join(', ')}
          </p>
        )}

        <div className="border-t border-zinc-800 pt-3 flex flex-col gap-2">
          <p className="text-xs text-zinc-500 uppercase tracking-wide">Create a crew</p>
          <div className="flex gap-2">
            <input
              value={newCrewName}
              onChange={(e) => setNewCrewName(e.target.value)}
              placeholder="Crew name"
              className="flex-1 bg-zinc-800 border border-zinc-600 text-zinc-100 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-sky-400"
            />
            <button
              onClick={createCrew}
              disabled={!newCrewName.trim()}
              className="text-sm bg-sky-500 hover:bg-sky-400 disabled:opacity-40 text-zinc-950 font-medium px-4 py-2 rounded-lg transition"
            >
              Create
            </button>
          </div>
        </div>

        {browseCrews.length > 0 && (
          <div className="border-t border-zinc-800 pt-3 flex flex-col gap-2">
            <p className="text-xs text-zinc-500 uppercase tracking-wide">Join a crew</p>
            {browseCrews.map((c) => (
              <div key={c.id} className="flex items-center justify-between text-sm">
                <span>{c.name}</span>
                <button
                  onClick={() => requestJoin(c.id)}
                  className="text-xs bg-zinc-800 hover:bg-zinc-700 border border-zinc-600 px-3 py-1 rounded-lg transition"
                >
                  Request to join
                </button>
              </div>
            ))}
          </div>
        )}

        {formError && <p className="text-xs text-rose-300">{formError}</p>}
      </div>

      {selectedCrewId && (
        <div className="w-full max-w-lg flex flex-col gap-2">
          {rows.length === 0 && (
            <p className="text-zinc-500 text-sm">No one in this crew has answered a question yet.</p>
          )}
          {rows.map((r, i) => {
            const isYou = r.user_id === user.id
            return (
              <div
                key={r.user_id}
                className={`flex items-center justify-between rounded-xl px-4 py-3 border ${
                  isYou ? 'bg-sky-500/10 border-sky-500/40' : 'bg-zinc-900 border-zinc-800'
                }`}
              >
                <div className="flex items-center gap-3">
                  <span className="text-zinc-500 text-sm w-6">#{i + 1}</span>
                  <span className={isYou ? 'text-sky-300 font-medium' : 'text-zinc-100'}>
                    {r.display_name} {isYou && '(you)'}
                  </span>
                  <span className="text-xs text-zinc-500 border border-zinc-700 rounded-full px-2 py-0.5">
                    {getBadge(r.score)}
                  </span>
                </div>
                <span className="text-sm text-zinc-300">
                  {r.score} pts{' '}
                  <span className="text-zinc-500">({Math.round(r.accuracy * 100)}%)</span>
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
