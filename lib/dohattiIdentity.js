const ID_KEY = 'dohatti_player_id'
const NAME_KEY = 'dohatti_player_name'

export function getPlayerId() {
  if (typeof window === 'undefined') return null
  let id = window.localStorage.getItem(ID_KEY)
  if (!id) {
    id = crypto.randomUUID()
    window.localStorage.setItem(ID_KEY, id)
  }
  return id
}

export function getPlayerName() {
  if (typeof window === 'undefined') return ''
  return window.localStorage.getItem(NAME_KEY) || ''
}

export function setPlayerName(name) {
  window.localStorage.setItem(NAME_KEY, name.trim())
}
