import "./App.css"
import { lazy, Suspense, useEffect, useState } from "react"
import { useCollab } from "./useCollab"

// Loaded on demand so the Monaco bundle is only fetched when Code mode is used
const CodeEditor = lazy(() => import("./CodeEditor"))
const DocEditor = lazy(() => import("./DocEditor"))

const USERNAME_KEY = "syncstudio-username"
const DEFAULT_ROOM = "main"

function cleanRoom(value) {
  return (value || "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
}

function readInitialState() {
  const params = new URLSearchParams(window.location.search)

  let savedName = ""
  try {
    savedName = sessionStorage.getItem(USERNAME_KEY) || ""
  } catch {
    // storage can be blocked; the username then simply isn't remembered
  }

  return {
    // ?username= is still supported for old links
    username: (params.get("username") || savedName).trim(),
    room: cleanRoom(params.get("room")) || DEFAULT_ROOM,
    mode: params.get("mode") === "code" ? "code" : "doc",
  }
}

const STATUS = {
  connected: { label: "Connected", dot: "bg-green-400" },
  connecting: { label: "Connecting…", dot: "bg-amber-400" },
  disconnected: { label: "Offline", dot: "bg-red-400" },
}

function App() {
  const [initial] = useState(readInitialState)
  const [username, setUsername] = useState(initial.username)
  const [room, setRoom] = useState(initial.room)
  const [mode, setMode] = useState(initial.mode)
  const [copied, setCopied] = useState(false)

  const { session, users, status } = useCollab(room, username)

  // Keep the URL shareable: room + mode (never the username)
  useEffect(() => {
    if (!username) return
    const params = new URLSearchParams({ room, mode })
    window.history.replaceState({}, "", `?${params.toString()}`)
  }, [username, room, mode])

  // -----------------------------
  // JOIN
  // -----------------------------

  const handleJoin = (e) => {
    e.preventDefault()

    const name = e.target.username.value.trim()
    const roomName = cleanRoom(e.target.room.value) || DEFAULT_ROOM

    if (!name) {
      alert("Please enter a username")
      return
    }

    try {
      sessionStorage.setItem(USERNAME_KEY, name)
    } catch {
      // ignore
    }

    setRoom(roomName)
    setUsername(name)
  }

  const handleCopyLink = async () => {
    const params = new URLSearchParams({ room, mode })
    const link = `${window.location.origin}${window.location.pathname}?${params.toString()}`

    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      window.prompt("Copy this link", link)
    }
  }

  // -----------------------------
  // LOGIN SCREEN
  // -----------------------------

  if (!username) {
    return (
      <main className="h-screen w-full bg-gray-950 flex p-4 items-center justify-center">
        <form onSubmit={handleJoin} className="flex flex-col gap-4 w-full max-w-xs">
          <h1 className="text-3xl font-bold text-amber-50">SyncStudio</h1>
          <p className="text-sm text-gray-400 -mt-2">
            Write documents and code together, in real time.
          </p>

          <input
            type="text"
            name="username"
            placeholder="Enter your username"
            autoComplete="off"
            maxLength={30}
            autoFocus
            className="p-2 rounded-lg bg-gray-800 text-white outline-none"
          />

          <input
            type="text"
            name="room"
            defaultValue={room}
            placeholder="Room name"
            autoComplete="off"
            maxLength={40}
            className="p-2 rounded-lg bg-gray-800 text-white outline-none"
          />

          <button type="submit" className="p-2 rounded-lg bg-amber-50 text-gray-950 font-bold">
            Join
          </button>
        </form>
      </main>
    )
  }

  // -----------------------------
  // EDITOR SCREEN
  // -----------------------------

  const statusInfo = STATUS[status] || STATUS.connecting

  const loading = (
    <div className="h-full flex items-center justify-center text-gray-400">Loading…</div>
  )

  const tab = (value, label) => (
    <button
      type="button"
      onClick={() => setMode(value)}
      aria-pressed={mode === value}
      className={`px-4 py-1.5 text-sm font-semibold ${
        mode === value ? "bg-amber-50 text-gray-950" : "text-gray-300 hover:bg-gray-800"
      }`}
    >
      {label}
    </button>
  )

  return (
    <main className="h-screen w-full bg-gray-950 flex flex-col gap-3 p-4">

      {/* HEADER */}

      <header className="no-print flex flex-wrap items-center gap-3 text-white">
        <h1 className="text-xl font-bold text-amber-50">SyncStudio</h1>

        <span className="px-2 py-1 rounded bg-gray-800 text-sm">
          room: <b>{room}</b>
        </span>

        <span className="flex items-center gap-2 text-sm text-gray-300">
          <span className={`w-2 h-2 rounded-full ${statusInfo.dot}`} />
          {statusInfo.label}
        </span>

        <span className="text-sm text-gray-400 md:hidden">{users.length} online</span>

        <div className="ml-auto flex items-center gap-3">
          <div className="flex rounded-lg overflow-hidden border border-gray-700">
            {tab("doc", "Doc")}
            {tab("code", "Code")}
          </div>

          <button
            type="button"
            onClick={handleCopyLink}
            className="px-3 py-1.5 rounded-lg border border-gray-700 text-sm hover:bg-gray-800"
          >
            {copied ? "Copied!" : "Copy invite link"}
          </button>
        </div>
      </header>

      <div className="flex flex-1 min-h-0 gap-4">

        {/* USERS */}

        <aside className="no-print hidden md:block h-full w-56 shrink-0 bg-amber-50 rounded-lg overflow-auto">
          <h2 className="text-xl font-bold p-4 border-b border-gray-300">
            Users ({users.length})
          </h2>

          <ul className="p-4">
            {users.map((user) => (
              <li
                key={user.clientId}
                className="p-2 bg-gray-800 text-white rounded mb-2 flex items-center gap-2"
              >
                <span
                  className="w-3 h-3 rounded-full shrink-0"
                  style={{ backgroundColor: user.color }}
                />
                <span className="truncate">{user.name}</span>
                {user.isMe && <span className="ml-auto text-xs text-gray-400">you</span>}
              </li>
            ))}
          </ul>
        </aside>

        {/* EDITOR */}

        <section className="flex-1 min-w-0 bg-neutral-800 rounded-lg overflow-hidden">
          {!session ? (
            loading
          ) : (
            <Suspense fallback={loading}>
              {mode === "code" ? (
                <CodeEditor
                  key={`code-${room}`}
                  ydoc={session.ydoc}
                  provider={session.provider}
                />
              ) : (
                <DocEditor
                  key={`doc-${room}`}
                  ydoc={session.ydoc}
                  provider={session.provider}
                  user={session.user}
                  room={room}
                />
              )}
            </Suspense>
          )}
        </section>

      </div>
    </main>
  )
}

export default App
