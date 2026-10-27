import { useEffect, useState } from "react"
import * as Y from "yjs"
import { SocketIOProvider } from "y-socket.io"

const COLORS = [
  "#f87171", "#fb923c", "#fbbf24", "#a3e635", "#34d399",
  "#22d3ee", "#60a5fa", "#a78bfa", "#f472b6", "#e879f9",
]

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
export function useCollab(room, username) {
  const [session, setSession] = useState(null)
  const [users, setUsers] = useState([])
  const [status, setStatus] = useState("connecting")

  useEffect(() => {
    if (!room || !username) return

    const ydoc = new Y.Doc()
    const provider = new SocketIOProvider(
      import.meta.env.VITE_CONNECT,
      room,
      ydoc,
      { autoConnect: true }
    )

    const user = { name: username, color: colorFor(username) }
    provider.awareness.setLocalStateField("user", user)

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
    const style = document.createElement("style")
    const updateCursorStyles = () => {
      let css = ""
      provider.awareness.getStates().forEach((state, clientId) => {
        if (!state.user?.name || clientId === provider.awareness.clientID) return
        const color = state.user.color || "#fbbf24"
        css += `
          .yRemoteSelection-${clientId} { background-color: ${color}55; }
          .yRemoteSelectionHead-${clientId} {
            position: absolute;
            border-left: 2px solid ${color};
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
            background: ${color};
            border-radius: 3px 3px 3px 0;
            white-space: nowrap;
            pointer-events: none;
          }
        `
      })
      style.textContent = css
    }
    document.head.appendChild(style)

    const onAwareness = () => {
      updateUsers()
      updateCursorStyles()
    }
    const onStatus = ({ status }) => setStatus(status)

    provider.awareness.on("change", onAwareness)
    provider.on("status", onStatus)
    onAwareness()

    setSession({ ydoc, provider, user })

    return () => {
      provider.awareness.off("change", onAwareness)
      provider.off("status", onStatus)
      style.remove()
      provider.destroy()
      ydoc.destroy()
      setSession(null)
      setUsers([])
      setStatus("connecting")
    }
  }, [room, username])

  return { session, users, status }
}
