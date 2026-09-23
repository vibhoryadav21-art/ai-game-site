'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabaseClient'
import { useLanguage } from '@/context/LanguageContext'

const BADGES = [
  { min: 0, name: 'Beginner' },
  { min: 10, name: 'Challenger' },
  { min: 20, name: 'Advanced' },
  { min: 30, name: 'Pro' },
  { min: 50, name: 'Master' },
]
const MAX_CREWS = 5
const CHALLENGE_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1']
const CHALLENGE_COUNTS = [5, 10, 15, 20, 25, 30]

function shuffle(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

function getBadge(score) {
  let badge = BADGES[0].name
  for (const tier of BADGES) {
    if (score >= tier.min) badge = tier.name
  }
  return badge
}

export default function GermanLeaderboardPage() {
  const { t } = useLanguage()
  const tc = t.crews
  const tcc = t.crewChallenge
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

  // Crew challenges: a fixed set of questions everyone in the crew answers,
  // scored and compared. Kept entirely separate from personal practice
  // tracking (no-repeat/reset/favorites) — challenges track their own
  // crew-wide question-usage history instead.
  const [challenges, setChallenges] = useState([])
  const [challengeParticipation, setChallengeParticipation] = useState({})
  const [challengeLevel, setChallengeLevel] = useState('all')
  const [challengeCount, setChallengeCount] = useState(10)
  const [creatingChallenge, setCreatingChallenge] = useState(false)
  const [challengeError, setChallengeError] = useState('')

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

  const loadChallenges = useCallback(
    async (crewId) => {
      if (!crewId) {
        setChallenges([])
        setChallengeParticipation({})
        return
      }
      const { data: challengeRows, error } = await supabase
        .from('crew_challenges')
        .select('*')
        .eq('crew_id', crewId)
        .order('created_at', { ascending: false })

      if (error) {
        console.error('Failed to load challenges:', error.message)
        return
      }
      setChallenges(challengeRows || [])

      if (challengeRows && challengeRows.length > 0 && user) {
        const ids = challengeRows.map((c) => c.id)
        const { data: myParticipation } = await supabase
          .from('challenge_participants')
          .select('challenge_id, status, score')
          .eq('user_id', user.id)
          .in('challenge_id', ids)
        setChallengeParticipation(Object.fromEntries((myParticipation || []).map((p) => [p.challenge_id, p])))
      } else {
        setChallengeParticipation({})
      }
    },
    [user]
  )

  useEffect(() => {
    loadLeaderboardForCrew(selectedCrewId)
    loadChallenges(selectedCrewId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCrewId, loadLeaderboardForCrew, loadChallenges])

  async function createChallenge() {
    setChallengeError('')
    if (!selectedCrewId) return
    setCreatingChallenge(true)
    try {
      // 1. Pool of questions matching the chosen level.
      let poolQuery = supabase.from('german_questions').select('id')
      if (challengeLevel !== 'all') poolQuery = poolQuery.eq('level', challengeLevel)
      const { data: pool, error: poolError } = await poolQuery
      if (poolError) throw new Error(poolError.message)
      if (!pool || pool.length === 0) {
        setChallengeError(tcc.noQuestionsForLevel)
        return
      }
      const poolIds = pool.map((p) => p.id)

      // 2. This crew's usage history for this level, so challenges rotate
      // through fresh questions instead of repeating until the whole pool
      // has been used at least once.
      const { data: history } = await supabase
        .from('crew_challenge_question_history')
        .select('question_id, last_used_at')
        .eq('crew_id', selectedCrewId)
        .eq('level', challengeLevel)

      const usedMap = Object.fromEntries((history || []).map((h) => [h.question_id, h.last_used_at]))
      const unused = poolIds.filter((id) => !(id in usedMap))
      const used = poolIds
        .filter((id) => id in usedMap)
        .sort((a, b) => new Date(usedMap[a]) - new Date(usedMap[b]))

      const count = Math.min(challengeCount, poolIds.length)
      let selected
      if (unused.length >= count) {
        selected = shuffle(unused).slice(0, count)
      } else {
        selected = [...unused, ...used.slice(0, count - unused.length)]
      }

      if (selected.length === 0) {
        setChallengeError(tcc.noQuestionsForLevel)
        return
      }
      const orderedIds = shuffle(selected)

      // 3. Create the challenge with this fixed set — everyone in the crew
      // answers the exact same questions, in the same order.
      const { data: challenge, error: createError } = await supabase
        .from('crew_challenges')
        .insert({
          crew_id: selectedCrewId,
          created_by: user.id,
          level: challengeLevel,
          question_count: orderedIds.length,
          question_ids: orderedIds,
        })
        .select()
        .single()
      if (createError) throw new Error(createError.message)

      // 4. Record usage so the next challenge for this crew+level knows
      // which questions have already been used.
      const nowIso = new Date().toISOString()
      await supabase.from('crew_challenge_question_history').upsert(
        orderedIds.map((qid) => ({
          crew_id: selectedCrewId,
          level: challengeLevel,
          question_id: qid,
          last_used_at: nowIso,
        })),
        { onConflict: 'crew_id,level,question_id' }
      )

      if (orderedIds.length < challengeCount) {
        setChallengeError(tcc.createdWithFewer(orderedIds.length))
      }
      setChallenges((prev) => [challenge, ...prev])
    } catch (err) {
      console.error('Failed to create challenge:', err.message)
      setChallengeError(tcc.createError)
    } finally {
      setCreatingChallenge(false)
    }
  }

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
      setFormError(tc.maxCrewsError(MAX_CREWS))
      return
    }

    const { data: crew, error } = await supabase
      .from('crews')
      .insert({ name, admin_id: user.id })
      .select()
      .single()

    if (error) {
      setFormError(error.code === '23505' ? tc.nameTakenError : tc.createError)
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
      setFormError(tc.maxCrewsError(MAX_CREWS))
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
      <div className="flex-1 bg-black text-zinc-100 flex items-center justify-center">
        <p className="text-zinc-400">{tc.loading}</p>
      </div>
    )
  }

  if (!user) {
    return (
      <div className="flex-1 bg-black text-zinc-100 flex items-center justify-center">
        <p className="text-zinc-300">{tc.loginPrompt}</p>
      </div>
    )
  }

  return (
    <div className="flex-1 bg-black text-zinc-100 flex flex-col items-center gap-6 p-6">
      <div className="w-full max-w-lg flex items-center justify-between">
        <h1 className="font-serif text-2xl text-sky-300">{tc.title}</h1>
        <Link href="/learning/german" className="text-xs text-zinc-400 hover:text-sky-300 transition">
          {tc.backToPractice}
        </Link>
      </div>

      {adminRequests.length > 0 && (
        <div className="w-full max-w-lg bg-zinc-900 border border-zinc-700 rounded-xl p-4 flex flex-col gap-2">
          <p className="text-xs text-zinc-500 uppercase tracking-wide">{tc.requestsToApprove}</p>
          {adminRequests.map((r) => (
            <div key={r.id} className="flex items-center justify-between text-sm">
              <span>{tc.wantsToJoin(r.requesterName, r.crewName)}</span>
              <div className="flex gap-2">
                <button
                  onClick={() => respondToRequest(r.id, true)}
                  className="text-xs bg-emerald-700 hover:bg-emerald-600 px-2 py-1 rounded-lg transition"
                >
                  {tc.accept}
                </button>
                <button
                  onClick={() => respondToRequest(r.id, false)}
                  className="text-xs bg-rose-900 hover:bg-rose-800 px-2 py-1 rounded-lg transition"
                >
                  {tc.deny}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="w-full max-w-lg bg-zinc-900 border border-zinc-700 rounded-xl p-4 flex flex-col gap-3">
        <p className="text-xs text-zinc-500 uppercase tracking-wide">
          {tc.yourCrews(myCrews.length, MAX_CREWS)}
        </p>

        {myCrews.length === 0 ? (
          <p className="text-sm text-zinc-500">{tc.notInCrew}</p>
        ) : (
          <select
            value={selectedCrewId}
            onChange={(e) => selectCrew(e.target.value)}
            className="bg-zinc-800 border border-zinc-600 text-zinc-100 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-sky-400"
          >
            <option value="">{tc.selectCrewPrompt}</option>
            {myCrews.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}

        {pendingCrews.length > 0 && (
          <p className="text-xs text-zinc-500">
            {tc.pendingApproval(pendingCrews.map((c) => c.name).join(', '))}
          </p>
        )}

        <div className="border-t border-zinc-800 pt-3 flex flex-col gap-2">
          <p className="text-xs text-zinc-500 uppercase tracking-wide">{tc.createCrew}</p>
          <div className="flex gap-2">
            <input
              value={newCrewName}
              onChange={(e) => setNewCrewName(e.target.value)}
              placeholder={tc.crewNamePlaceholder}
              className="flex-1 bg-zinc-800 border border-zinc-600 text-zinc-100 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-sky-400"
            />
            <button
              onClick={createCrew}
              disabled={!newCrewName.trim()}
              className="text-sm bg-sky-500 hover:bg-sky-400 disabled:opacity-40 text-zinc-950 font-medium px-4 py-2 rounded-lg transition"
            >
              {tc.create}
            </button>
          </div>
        </div>

        {browseCrews.length > 0 && (
          <div className="border-t border-zinc-800 pt-3 flex flex-col gap-2">
            <p className="text-xs text-zinc-500 uppercase tracking-wide">{tc.joinCrew}</p>
            {browseCrews.map((c) => (
              <div key={c.id} className="flex items-center justify-between text-sm">
                <span>{c.name}</span>
                <button
                  onClick={() => requestJoin(c.id)}
                  className="text-xs bg-zinc-800 hover:bg-zinc-700 border border-zinc-600 px-3 py-1 rounded-lg transition"
                >
                  {tc.requestToJoin}
                </button>
              </div>
            ))}
          </div>
        )}

        {formError && <p className="text-xs text-rose-300">{formError}</p>}
      </div>

      {selectedCrewId && (
        <div className="w-full max-w-lg bg-zinc-900 border border-zinc-700 rounded-xl p-4 flex flex-col gap-3">
          <p className="text-xs text-zinc-500 uppercase tracking-wide">{tcc.sectionTitle}</p>

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={challengeLevel}
              onChange={(e) => setChallengeLevel(e.target.value)}
              className="bg-zinc-800 border border-zinc-600 text-zinc-100 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-sky-400"
            >
              <option value="all">{tcc.levelAll}</option>
              {CHALLENGE_LEVELS.map((lvl) => (
                <option key={lvl} value={lvl}>
                  {lvl}
                </option>
              ))}
            </select>
            <select
              value={challengeCount}
              onChange={(e) => setChallengeCount(Number(e.target.value))}
              className="bg-zinc-800 border border-zinc-600 text-zinc-100 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-sky-400"
            >
              {CHALLENGE_COUNTS.map((n) => (
                <option key={n} value={n}>
                  {tcc.questionsOption(n)}
                </option>
              ))}
            </select>
            <button
              onClick={createChallenge}
              disabled={creatingChallenge}
              className="text-sm bg-sky-500 hover:bg-sky-400 disabled:opacity-40 text-zinc-950 font-medium px-4 py-2 rounded-lg transition"
            >
              {creatingChallenge ? tcc.creating : tcc.create}
            </button>
          </div>

          {challengeError && <p className="text-xs text-rose-300">{challengeError}</p>}

          {challenges.length === 0 ? (
            <p className="text-sm text-zinc-500">{tcc.noChallengesYet}</p>
          ) : (
            <div className="flex flex-col gap-2">
              {challenges.map((c) => {
                const mine = challengeParticipation[c.id]
                const statusLabel =
                  !mine || mine.status === 'not_started'
                    ? tcc.statusNotStarted
                    : mine.status === 'in_progress'
                    ? tcc.statusInProgress
                    : tcc.statusCompleted(mine.score)
                return (
                  <Link
                    key={c.id}
                    href={`/learning/german/challenge/${c.id}`}
                    className="flex items-center justify-between bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg px-3 py-2 transition text-sm"
                  >
                    <span>{tcc.summary(c.level === 'all' ? tcc.levelAll : c.level, c.question_count)}</span>
                    <span className="text-xs text-zinc-400">{statusLabel}</span>
                  </Link>
                )
              })}
            </div>
          )}
        </div>
      )}

      {selectedCrewId && (
        <div className="w-full max-w-lg flex flex-col gap-2">
          {rows.length === 0 && (
            <p className="text-zinc-500 text-sm">{tc.emptyLeaderboard}</p>
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
                    {r.display_name} {isYou && tc.you}
                  </span>
                  <span className="text-xs text-zinc-500 border border-zinc-700 rounded-full px-2 py-0.5">
                    {getBadge(r.score)}
                  </span>
                </div>
                <span className="text-sm text-zinc-300">
                  {r.score} {tc.ptsSuffix}{' '}
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
