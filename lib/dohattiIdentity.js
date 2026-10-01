// Each browser keeps a private SECRET. The public player id is the SHA-256 hash of it.
// The id goes into the database; the secret only ever goes to our own server routes
// as proof that "this seat is really mine".

const SECRET_KEY = 'dohatti_player_secret'
const ID_KEY = 'dohatti_player_id'
const NAME_KEY = 'dohatti_player_name'

async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

// Call (and await) this once before using the other functions on a page.
export async function ensureIdentity() {
  if (typeof window === 'undefined') return null
  let secret = window.localStorage.getItem(SECRET_KEY)
  let id = window.localStorage.getItem(ID_KEY)
  if (!secret || !id) {
    secret = crypto.randomUUID() + crypto.randomUUID()
    id = await sha256Hex(secret)
    window.localStorage.setItem(SECRET_KEY, secret)
    window.localStorage.setItem(ID_KEY, id)
  }
  return id
}

export function getPlayerId() {
  if (typeof window === 'undefined') return null
  return window.localStorage.getItem(ID_KEY)
}

export function getPlayerSecret() {
  if (typeof window === 'undefined') return null
  return window.localStorage.getItem(SECRET_KEY)
}

export function getPlayerName() {
  if (typeof window === 'undefined') return ''
  return window.localStorage.getItem(NAME_KEY) || ''
}

export function setPlayerName(name) {
  window.localStorage.setItem(NAME_KEY, name.trim())
}
