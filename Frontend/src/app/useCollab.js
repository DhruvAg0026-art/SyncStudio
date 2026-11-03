import { useEffect, useRef, useState } from "react"
import * as Y from "yjs"
import { SocketIOProvider } from "y-socket.io"

const COLORS = [
  "#f87171", "#fb923c", "#fbbf24", "#a3e635", "#34d399",
  "#22d3ee", "#60a5fa", "#a78bfa", "#f472b6", "#e879f9",
]
const SESSION_TOKEN_KEY = "syncstudio-session-token"

async function getSessionToken() {
  const storageKey = SESSION_TOKEN_KEY
  let token = ""
  try {
    token = localStorage.getItem(storageKey) || ""
  } catch {
    // Request a short-lived session if browser storage is unavailable.
  }
  if (token) return token

  const baseUrl = import.meta.env.VITE_CONNECT.replace(/\/+$/, "")
  const response = await fetch(`${baseUrl}/api/session`, { method: "POST" })
  if (!response.ok) throw new Error("Could not create a room session.")
  const data = await response.json()
  if (typeof data.token !== "string") throw new Error("The server returned an invalid room session.")
  try {
    localStorage.setItem(storageKey, data.token)
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
export function useCollab(room, username, color = colorFor(username || "")) {
  const [session, setSession] = useState(null)
  const [users, setUsers] = useState([])
  const [status, setStatus] = useState("connecting")
  const [members, setMembers] = useState([])
  const [ownerId, setOwnerId] = useState(null)
  const [roomNotice, setRoomNotice] = useState("")
  const hasUsername = Boolean(username)
  const profileRef = useRef({ username, color })
  profileRef.current = { username, color }

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
        const sessionToken = await getSessionToken()
        if (!active) return

        ydoc = new Y.Doc()
        provider = new SocketIOProvider(
          import.meta.env.VITE_CONNECT,
          room,
          ydoc,
          { autoConnect: true, auth: { sessionToken } }
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
        }
        joinRoom = () => {
          const profile = profileRef.current
          provider.socket.emit("room:join", { name: profile.username, color: profile.color }, (response) => {
            if (response?.error) {
              setRoomNotice(response.error)
              return
            }
            onRoomState(response.state)
          })
        }
        onKicked = () => setRoomNotice("You were removed from this room by its owner.")
        onDeleted = () => setRoomNotice("This room was deleted by its owner.")
        onConnectError = () => {
          setRoomNotice("Could not join this room. It may have been deleted or the session expired.")
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
      setStatus("connecting")
      setRoomNotice("")
    }
  }, [room, hasUsername])

  const provider = session?.provider

  useEffect(() => {
    if (!provider) return
    const user = { name: username, color }
    provider.awareness.setLocalStateField("user", user)
    provider.socket.emit("room:update-profile", user)
    setSession((current) => current?.provider === provider
      ? { ...current, user }
      : current)
  }, [provider, username, color])

  const leaveRoom = () => provider?.socket.emit("room:leave")
  const kickMember = (socketId) => provider?.socket.emit("room:kick", socketId)
  const deleteRoom = () => provider?.socket.emit("room:delete")

  return { session, users, status, members, ownerId, roomNotice, leaveRoom, kickMember, deleteRoom }
}
