import { useEffect, useRef, useState } from "react"
import * as Y from "yjs"
import { SocketIOProvider } from "y-socket.io"

const COLORS = [
  "#f87171", "#fb923c", "#fbbf24", "#a3e635", "#34d399",
  "#22d3ee", "#60a5fa", "#a78bfa", "#f472b6", "#e879f9",
]
const SESSION_TOKEN_KEY = "syncstudio-session-token"

function readTokenExpiry(token) {
  try {
    const encoded = token.split(".")[0].replace(/-/g, "+").replace(/_/g, "/")
    const padded = encoded.padEnd(Math.ceil(encoded.length / 4) * 4, "=")
    const binary = atob(padded)
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
    return Number(JSON.parse(new TextDecoder().decode(bytes)).exp) || 0
  } catch {
    return 0
  }
}

export async function getSessionToken(firebaseUser = null) {
  let storage
  const storageKey = firebaseUser ? `${SESSION_TOKEN_KEY}:${firebaseUser.uid}` : SESSION_TOKEN_KEY
  let token = ""
  let expiresAt = 0
  try {
    storage = firebaseUser ? localStorage : sessionStorage
    token = storage.getItem(storageKey) || ""
    expiresAt = Number(storage.getItem(`${storageKey}:expiresAt`)) || 0
    if (token && !expiresAt) {
      expiresAt = readTokenExpiry(token)
      if (expiresAt) storage.setItem(`${storageKey}:expiresAt`, String(expiresAt))
    }
  } catch {
    // Request a fresh session if browser storage is unavailable.
  }
  if (token && expiresAt > Date.now() + 60_000) return token

  const baseUrl = import.meta.env.VITE_CONNECT.replace(/\/+$/, "")
  const body = firebaseUser ? { idToken: await firebaseUser.getIdToken() } : {}
  const response = await fetch(`${baseUrl}/api/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error || "Could not create a room session.")
  }
  const data = await response.json()
  if (typeof data.token !== "string") throw new Error("The server returned an invalid room session.")
  try {
    storage.setItem(storageKey, data.token)
    storage.setItem(`${storageKey}:expiresAt`, String(data.expiresAt || Date.now() + 29 * 24 * 60 * 60 * 1000))
  } catch {
    // The session remains usable until this page is closed.
  }
  return data.token
}

export function colorFor(name) {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0
  }
  return COLORS[hash % COLORS.length]
}

// One Y.Doc + one socket connection per room. Both the code editor and the
// document editor use the same connection, so switching mode keeps everything in sync.
//   ydoc.getText("monaco")        -> code editor content
//   ydoc.getXmlFragment("doc")    -> rich-text document content
//   ydoc.getText("title")         -> document title
export function useCollab(
  room,
  username,
  color = colorFor(username || ""),
  firebaseUser = null,
  inviteToken = "",
  roomAccessToken = "",
) {
  const [session, setSession] = useState(null)
  const [users, setUsers] = useState([])
  const [status, setStatus] = useState("connecting")
  const [members, setMembers] = useState([])
  const [ownerId, setOwnerId] = useState(null)
  const [accessRole, setAccessRole] = useState(null)
  const [roomNotice, setRoomNotice] = useState("")
  const hasUsername = Boolean(username)
  const joinedRoomRef = useRef(false)
  const profileRef = useRef({ username, color })
  const firebaseUserRef = useRef(firebaseUser)
  profileRef.current = { username, color }
  firebaseUserRef.current = firebaseUser

  useEffect(() => {
    if (!room || !hasUsername) return

    let active = true
    let provider
    let ydoc
    let style
    let onAwareness
    let onStatus
    let onRoomState
    let joinRoom
    let onKicked
    let onDeleted
    let onConnectError

    const connect = async () => {
      try {
        const sessionToken = await getSessionToken(firebaseUserRef.current)
        if (!active) return

        ydoc = new Y.Doc()
        provider = new SocketIOProvider(
          import.meta.env.VITE_CONNECT,
          room,
          ydoc,
          { autoConnect: true, auth: { sessionToken, inviteToken, roomAccessToken } }
        )

        const updateUsers = () => {
          const list = []
          provider.awareness.getStates().forEach((state, clientId) => {
            if (state.user?.name) {
              list.push({
                clientId,
                name: state.user.name,
                color: state.user.color,
                isMe: clientId === provider.awareness.clientID,
              })
            }
          })
          setUsers(list)
        }

        // Colours + name labels for remote cursors/selections in the Monaco editor
        style = document.createElement("style")
        const updateCursorStyles = () => {
          let css = ""
          provider.awareness.getStates().forEach((state, clientId) => {
            if (!state.user?.name || clientId === provider.awareness.clientID) return
            const cursorColor = state.user.color || "#fbbf24"
            css += `
          .yRemoteSelection-${clientId} { background-color: ${cursorColor}55; }
          .yRemoteSelectionHead-${clientId} {
            position: absolute;
            border-left: 2px solid ${cursorColor};
            height: 100%;
            box-sizing: border-box;
          }
          .yRemoteSelectionHead-${clientId}::after {
            content: ${JSON.stringify(state.user.name)};
            position: absolute;
            top: -1.4em;
            left: -2px;
            padding: 0 4px;
            font-size: 11px;
            line-height: 1.4em;
            color: #111;
            background: ${cursorColor};
            border-radius: 3px 3px 3px 0;
            white-space: nowrap;
            pointer-events: none;
          }
        `
          })
          style.textContent = css
        }
        document.head.appendChild(style)

        onAwareness = () => {
          updateUsers()
          updateCursorStyles()
        }
        onStatus = ({ status }) => setStatus(status)
        onRoomState = (state) => {
          setMembers(state.members || [])
          setOwnerId(state.ownerId || null)
          const ownMember = state.members?.find((item) => item.socketId === provider.socket.id)
          if (ownMember) setAccessRole(ownMember.access || "edit")
        }
        joinRoom = () => {
          const profile = profileRef.current
          provider.socket.emit("room:join", { name: profile.username, color: profile.color }, (response) => {
            if (response?.error) {
              setRoomNotice(response.error)
              return
            }
            if (response?.warning) setRoomNotice(response.warning)
            joinedRoomRef.current = true
            onRoomState(response.state)
            const member = response.state?.members?.find((item) => item.socketId === provider.socket.id)
            if (member) {
              provider.awareness.setLocalStateField("user", { name: member.name, color: member.color })
              setSession((current) => current?.provider === provider
                ? { ...current, user: { name: member.name, color: member.color } }
                : current)
            }
          })
        }
        onKicked = () => setRoomNotice("You were removed from this room by its owner.")
        onDeleted = () => setRoomNotice("This room was deleted by its owner.")
        onConnectError = (error) => {
          setRoomNotice(error?.message || "Could not join this room. Check the invite link and try again.")
        }

        provider.awareness.on("change", onAwareness)
        provider.on("status", onStatus)
        provider.socket.on("connect", joinRoom)
        provider.socket.on("room:state", onRoomState)
        provider.socket.on("room:kicked", onKicked)
        provider.socket.on("room:deleted", onDeleted)
        onAwareness()

        provider.socket.on("connect_error", onConnectError)
        setSession({
          ydoc,
          provider,
          user: { name: profileRef.current.username, color: profileRef.current.color },
          sessionToken,
        })
      } catch (error) {
        if (active) {
          setStatus("disconnected")
          setRoomNotice(error.message)
        }
      }
    }

    connect()
    return () => {
      active = false
      joinedRoomRef.current = false
      if (provider) {
        provider.awareness.off("change", onAwareness)
        provider.off("status", onStatus)
        provider.socket.off("connect", joinRoom)
        provider.socket.off("room:state", onRoomState)
        provider.socket.off("room:kicked", onKicked)
        provider.socket.off("room:deleted", onDeleted)
        provider.socket.off("connect_error", onConnectError)
        provider.destroy()
      }
      style?.remove()
      ydoc?.destroy()
      setSession(null)
      setUsers([])
      setMembers([])
      setOwnerId(null)
      setAccessRole(null)
      setStatus("connecting")
      setRoomNotice("")
    }
  }, [room, hasUsername, firebaseUser?.uid, inviteToken, roomAccessToken])

  const provider = session?.provider

  useEffect(() => {
    if (!provider) return
    const user = { name: username, color }
    provider.awareness.setLocalStateField("user", user)
    if (!joinedRoomRef.current) return
    provider.socket.emit("room:update-profile", user, (response) => {
      if (response?.error) {
        setRoomNotice(response.error)
        return
      }
      const assignedUser = { name: response.name, color: response.color }
      provider.awareness.setLocalStateField("user", assignedUser)
      setSession((current) => current?.provider === provider
        ? { ...current, user: assignedUser }
        : current)
    })
  }, [provider, username, color])

  const leaveRoom = () => provider?.socket.emit("room:leave")
  const kickMember = (socketId) => provider?.socket.emit("room:kick", socketId)
  const deleteRoom = () => provider?.socket.emit("room:delete", (response) => {
    if (response?.error) setRoomNotice(response.error)
  })

  return { session, users, status, members, ownerId, accessRole, roomNotice, leaveRoom, kickMember, deleteRoom }
}
