import "./App.css"
import { lazy, Suspense, useEffect, useRef, useState } from "react"
import { onAuthStateChanged, signInWithPopup, signOut } from "firebase/auth"
import { colorFor, getSessionToken, useCollab } from "./useCollab"
import ChatSidebar from "./ChatSidebar"
import { auth, firebaseConfigured, googleProvider } from "./firebase"
import ConfirmDialog from "./ConfirmDialog"
import useDismissable from "./useDismissable"

// Loaded on demand so the Monaco bundle is only fetched when Code mode is used
const CodeEditor = lazy(() => import("./CodeEditor"))
const DocEditor = lazy(() => import("./DocEditor"))

const USERNAME_KEY = "syncstudio-username"
const PROFILE_KEY = "syncstudio-profile"
const RECENT_ROOMS_KEY = "syncstudio-recent-rooms"
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
  let profile = {}
  try {
    savedName = sessionStorage.getItem(USERNAME_KEY) || ""
    profile = JSON.parse(localStorage.getItem(PROFILE_KEY) || "{}")
  } catch {
    // Storage can be blocked; use the in-memory defaults.
  }

  const username = (params.get("username") || profile.name || savedName).trim()
  return {
    // ?username= is still supported for old links
    username,
    color: /^#[0-9a-f]{6}$/i.test(profile.color || "") ? profile.color : colorFor(username),
    room: cleanRoom(params.get("room")) || DEFAULT_ROOM,
    mode: params.get("mode") === "code" ? "code" : "doc",
    inviteToken: params.get("invite") || "",
  }
}

function readRecentRooms() {
  try {
    const rooms = JSON.parse(localStorage.getItem(RECENT_ROOMS_KEY) || "[]")
    return Array.isArray(rooms)
      ? rooms.filter((item) => item?.room && ["doc", "code"].includes(item.mode)).slice(0, 10)
      : []
  } catch {
    return []
  }
}

function readInitialTheme() {
  try {
    const savedTheme = localStorage.getItem("syncstudio-theme")
    if (savedTheme === "light" || savedTheme === "dark") return savedTheme
  } catch {
    // Fall through to the operating system preference.
  }
  return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark"
}

function ThemeToggle({ theme, onToggle }) {
  const nextTheme = theme === "dark" ? "light" : "dark"

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={onToggle}
      aria-label={`Switch to ${nextTheme} theme`}
      aria-pressed={theme === "dark"}
      title={`Switch to ${nextTheme} theme`}
    >
      <svg
        className="theme-toggle-icon"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
      >
        {theme === "dark" ? (
          <path
            d="M20.2 15.1A8.5 8.5 0 0 1 8.9 3.8 8.6 8.6 0 1 0 20.2 15.1Z"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : (
          <>
            <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.8" />
            <path
              d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </>
        )}
      </svg>
      <span className="sr-only">{theme === "dark" ? "Dark theme" : "Light theme"}</span>
    </button>
  )
}

const STATUS = {
  connected: { label: "Connected", dot: "bg-green-400" },
  connecting: { label: "Connecting…", dot: "bg-amber-400" },
  disconnected: { label: "Offline", dot: "bg-red-400" },
}

function App() {
  const [initial] = useState(readInitialState)
  const [username, setUsername] = useState(initial.username)
  const [joinName, setJoinName] = useState(initial.username)
  const [room, setRoom] = useState(initial.room)
  const [joinRoom, setJoinRoom] = useState(initial.room)
  const [mode, setMode] = useState(initial.mode)
  const [inviteToken, setInviteToken] = useState(initial.inviteToken)
  const [copied, setCopied] = useState("")
  const [profileColor, setProfileColor] = useState(initial.color)
  const [profileOpen, setProfileOpen] = useState(false)
  const [profileNameDraft, setProfileNameDraft] = useState(initial.username)
  const [profileColorDraft, setProfileColorDraft] = useState(initial.color)
  const [profileError, setProfileError] = useState("")
  const [recentRooms, setRecentRooms] = useState(readRecentRooms)
  const [theme, setTheme] = useState(readInitialTheme)
  const [chatOpen, setChatOpen] = useState(false)
  const [roomCreateError, setRoomCreateError] = useState("")
  const [roomCreating, setRoomCreating] = useState(false)
  const [privateRoom, setPrivateRoom] = useState(false)
  const [roomPassword, setRoomPassword] = useState("")
  const [joinPrivateRoom, setJoinPrivateRoom] = useState(false)
  const [joinPassword, setJoinPassword] = useState("")
  const [roomAccessToken, setRoomAccessToken] = useState("")
  const [shareOpen, setShareOpen] = useState(false)
  const [shareFallbackLink, setShareFallbackLink] = useState("")
  const [shareBusy, setShareBusy] = useState("")
  const [shareError, setShareError] = useState("")
  const [authUser, setAuthUser] = useState(null)
  const [authReady, setAuthReady] = useState(!auth)
  const [authError, setAuthError] = useState("")
  const [documents, setDocuments] = useState([])
  const [documentsLoading, setDocumentsLoading] = useState(false)
  const [documentsError, setDocumentsError] = useState("")
  const [documentsRefresh, setDocumentsRefresh] = useState(0)
  const [membersOpen, setMembersOpen] = useState(false)
  const [confirmation, setConfirmation] = useState(null)
  const shareMenuRef = useRef(null)
  const profileMenuRef = useRef(null)
  const shareFallbackInputRef = useRef(null)

  const {
    session,
    users,
    status,
    members,
    ownerId,
    accessRole,
    roomNotice,
    leaveRoom,
    kickMember,
    deleteRoom,
  } = useCollab(room, authReady ? username : "", profileColor, authUser, inviteToken, roomAccessToken)

  const selfSocketId = session?.provider.socket.id
  const isOwner = members.some((member) => member.socketId === selfSocketId && member.userId === ownerId)
  const autoSaveLeader = members
    .filter((member) => member.userId === ownerId)
    .slice()
    .sort((a, b) => a.joinedAt - b.joinedAt || a.socketId.localeCompare(b.socketId))[0]
  const autoSaveEnabled = Boolean(selfSocketId && autoSaveLeader?.socketId === selfSocketId)

  useDismissable(shareMenuRef, shareOpen, () => setShareOpen(false))
  useDismissable(profileMenuRef, profileOpen, () => setProfileOpen(false))

  useEffect(() => {
    setMembersOpen(false)
  }, [room])

  useEffect(() => {
    if (!auth) {
      setAuthReady(true)
      return
    }
    return onAuthStateChanged(
      auth,
      (user) => {
        setAuthUser(user)
        setAuthReady(true)
        if (user) setJoinName((current) => current || user.displayName || user.email || "")
      },
      (error) => {
        setAuthError(error.message)
        setAuthReady(true)
      }
    )
  }, [])

  useEffect(() => {
    if (!authUser || username) {
      setDocuments([])
      setDocumentsError("")
      return
    }

    let active = true
    const loadDocuments = async () => {
      setDocuments([])
      setDocumentsLoading(true)
      setDocumentsError("")
      try {
        const sessionToken = await getSessionToken(authUser)
        const response = await fetch(`${import.meta.env.VITE_CONNECT.replace(/\/+$/, "")}/api/documents`, {
          headers: { authorization: `Bearer ${sessionToken}` },
        })
        const result = await response.json()
        if (!response.ok) throw new Error(result.error || "Could not load My Documents.")
        if (active) setDocuments(result.documents || [])
      } catch (error) {
        if (active) setDocumentsError(error.message)
      } finally {
        if (active) setDocumentsLoading(false)
      }
    }
    loadDocuments()
    return () => {
      active = false
    }
  }, [authUser, username, documentsRefresh])

  useEffect(() => {
    if (roomNotice === "You were removed from this room by its owner."
      || roomNotice === "This room was deleted by its owner.") {
      setUsername("")
    }
  }, [roomNotice])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try {
      localStorage.setItem("syncstudio-theme", theme)
    } catch {
      // The current selection still applies for this session.
    }
  }, [theme])

  // Keep the URL shareable: room + mode (never the username)
  useEffect(() => {
    if (!username) return
    const params = new URLSearchParams({ room, mode })
    if (inviteToken) params.set("invite", inviteToken)
    window.history.replaceState({}, "", `?${params.toString()}`)
  }, [username, room, mode, inviteToken])

  useEffect(() => {
    if (!username) return

    const nextRooms = [
      { room, mode, lastVisited: Date.now() },
      ...readRecentRooms().filter((item) => item.room !== room),
    ].slice(0, 10)
    setRecentRooms(nextRooms)
    try {
      localStorage.setItem(RECENT_ROOMS_KEY, JSON.stringify(nextRooms))
    } catch {
      // Recent rooms remain available in memory until the page is closed.
    }
  }, [username, room, mode])

  // -----------------------------
  // JOIN
  // -----------------------------

  const handleGoogleSignIn = async () => {
    setAuthError("")
    if (!auth || !googleProvider) {
      setAuthError("Google sign-in needs Firebase web settings in Frontend/.env and service-account settings on the backend.")
      return
    }
    try {
      const credential = await signInWithPopup(auth, googleProvider)
      setAuthUser(credential.user)
      setJoinName((current) => current || credential.user.displayName || credential.user.email || "")
      setUsername("")
    } catch (error) {
      setAuthError(error.message || "Google sign-in failed.")
    }
  }

  const handleSignOut = async () => {
    setAuthError("")
    if (!auth) return
    try {
      await signOut(auth)
      setAuthUser(null)
      setUsername("")
      setJoinName("")
      setDocuments([])
      try {
        sessionStorage.removeItem(USERNAME_KEY)
      } catch {
        // The account is signed out even if browser storage is unavailable.
      }
    } catch (error) {
      setAuthError(error.message || "Could not sign out.")
    }
  }

  const handleJoin = async (event) => {
    event.preventDefault()

    const trimmedName = joinName.trim()
    if (!trimmedName) {
      setRoomCreateError("Enter a display name before joining a room.")
      return
    }

    const roomName = cleanRoom(joinRoom)
    if (!roomName) {
      setRoomCreateError("Choose a room to join.")
      return
    }

    setRoomCreateError("")
    setInviteToken("")
    setRoomAccessToken("")

    try {
      sessionStorage.setItem(USERNAME_KEY, trimmedName)
      localStorage.setItem(PROFILE_KEY, JSON.stringify({ name: trimmedName, color: profileColor }))
    } catch {
      // The profile stays usable in memory even if storage is unavailable.
    }

    try {
      if (joinPrivateRoom) {
        const password = joinPassword.trim()
        if (password.length < 6) {
          setRoomCreateError("Private rooms require a password of at least 6 characters.")
          return
        }

        const sessionToken = await getSessionToken(authUser)
        const response = await fetch(
          `${import.meta.env.VITE_CONNECT.replace(/\/+$/, "")}/api/rooms/${encodeURIComponent(roomName)}/access`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: `Bearer ${sessionToken}`,
            },
            body: JSON.stringify({ password }),
          }
        )
        const result = await response.json()
        if (!response.ok) throw new Error(result.error || "Could not verify this room password.")

        setRoomAccessToken(result.roomAccessToken || "")
        setJoinName(trimmedName)
        setRoom(roomName)
        setJoinRoom(roomName)
        setJoinPrivateRoom(false)
        setJoinPassword("")
        setUsername(trimmedName)
        return
      }

      setJoinName(trimmedName)
      setRoom(roomName)
      setJoinRoom(roomName)
      setUsername(trimmedName)
    } catch (error) {
      setRoomCreateError(error.message || "Could not join this room.")
      setUsername("")
    }
  }

  const saveProfile = (event) => {
    event.preventDefault()
    const name = profileNameDraft.trim()
    if (name.length < 1 || name.length > 24) {
      setProfileError("Name must be between 1 and 24 characters.")
      return
    }

    setProfileError("")
    setUsername((current) => current ? name : current)
    setJoinName(name)
    setProfileNameDraft(name)
    setProfileColor(profileColorDraft)
    try {
      sessionStorage.setItem(USERNAME_KEY, name)
      localStorage.setItem(PROFILE_KEY, JSON.stringify({ name, color: profileColorDraft }))
    } catch {
      // The profile is updated for this session even if storage is unavailable.
    }
    setProfileOpen(false)
  }

  const toggleTheme = () => setTheme((current) => current === "dark" ? "light" : "dark")

  const openRecentRoom = (recent) => {
    setJoinRoom(recent.room)
    setMode(recent.mode)
    setRoomCreateError("")
    setInviteToken("")
    setJoinPrivateRoom(false)
    setJoinPassword("")
    setRoomAccessToken("")
    const name = joinName.trim()
    if (!name) {
      setRoomCreateError("Enter a display name before opening a recent room.")
      return
    }
    try {
      sessionStorage.setItem(USERNAME_KEY, name)
      localStorage.setItem(PROFILE_KEY, JSON.stringify({ name, color: profileColor }))
    } catch {
      // The room can still be opened without persistent browser storage.
    }
    setRoom(recent.room)
    setUsername(name)
  }

  const removeRecentRoom = (roomName) => {
    const nextRooms = recentRooms.filter((item) => item.room !== roomName)
    setRecentRooms(nextRooms)
    try {
      localStorage.setItem(RECENT_ROOMS_KEY, JSON.stringify(nextRooms))
    } catch {
      // Keep the change in memory.
    }
  }

  const clearRecentRooms = () => {
    setRecentRooms([])
    try {
      localStorage.removeItem(RECENT_ROOMS_KEY)
    } catch {
      // Keep the list cleared in memory.
    }
  }

  const createRoom = async (requestedRoom = "") => {
    const trimmedName = joinName.trim()
    if (!trimmedName) {
      setRoomCreateError("Enter a display name before creating a room.")
      return
    }

    const nextRoom = cleanRoom(requestedRoom || joinRoom)
    if (privateRoom && roomPassword.trim().length < 6) {
      setRoomCreateError("Private rooms require a password of at least 6 characters.")
      return
    }

    setRoomCreateError("")
    setInviteToken("")
    setRoomAccessToken("")
    setRoomCreating(true)

    try {
      const sessionToken = await getSessionToken(authUser)
      const response = await fetch(`${import.meta.env.VITE_CONNECT.replace(/\/+$/, "")}/api/rooms`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${sessionToken}`,
        },
        body: JSON.stringify({
          room: nextRoom || undefined,
          privateRoom,
          password: roomPassword.trim(),
        }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || "Could not create this room.")

      const createdRoom = result.room || nextRoom || ""
      if (!createdRoom) throw new Error("The server did not return a room name.")

      setJoinName(trimmedName)
      setJoinRoom(createdRoom)
      setRoom(createdRoom)
      setUsername(trimmedName)
      setPrivateRoom(false)
      setRoomPassword("")
      setJoinPrivateRoom(false)
      setJoinPassword("")
      try {
        sessionStorage.setItem(USERNAME_KEY, trimmedName)
        localStorage.setItem(PROFILE_KEY, JSON.stringify({ name: trimmedName, color: profileColor }))
      } catch {
        // The profile stays usable in memory even if storage is unavailable.
      }
    } catch (error) {
      setRoomCreateError(error.message || "Could not create this room.")
      setUsername("")
    } finally {
      setRoomCreating(false)
    }
  }

  const handleCreateRoom = (event) => {
    event.preventDefault()
    createRoom()
  }

  const handleGenerateRoom = (event) => {
    event.preventDefault()
    createRoom()
  }

  const openDocument = (document) => {
    const name = joinName.trim() || authUser?.displayName || authUser?.email || ""
    if (!name) {
      setAuthError("Enter a display name before opening a document.")
      return
    }
    setJoinName(name)
    setJoinRoom(document.room)
    setMode("doc")
    setInviteToken("")
    setRoom(document.room)
    setUsername(name)
  }

  const handleCopyLink = async (access) => {
    setShareError("")
    setShareBusy(access || "link")
    try {
      let linkInvite = inviteToken
      if (access) {
        const sessionToken = await getSessionToken(authUser)
        const response = await fetch(
          `${import.meta.env.VITE_CONNECT.replace(/\/+$/, "")}/api/rooms/${encodeURIComponent(room)}/invites`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: `Bearer ${sessionToken}`,
            },
            body: JSON.stringify({ access }),
          }
        )
        const result = await response.json()
        if (!response.ok) throw new Error(result.error || "Could not create an invite link.")
        linkInvite = result.inviteToken
      }

      const params = new URLSearchParams({ room, mode })
      if (linkInvite) params.set("invite", linkInvite)
      const link = `${window.location.origin}${window.location.pathname}?${params.toString()}`
      let copiedToClipboard = false
      try {
        await navigator.clipboard.writeText(link)
        copiedToClipboard = true
      } catch {
        setShareFallbackLink(link)
      }
      if (copiedToClipboard) {
        setCopied(access || "link")
        setTimeout(() => setCopied(""), 1500)
      }
      setShareOpen(false)
    } catch (error) {
      setShareError(error.message || "Could not create an invite link.")
    } finally {
      setShareBusy("")
    }
  }

  // -----------------------------
  // LOGIN SCREEN
  // -----------------------------

  if (!authReady) {
    return (
      <main className="app-login h-screen w-full flex items-center justify-center">
        <p className="join-subtitle">Checking your account…</p>
      </main>
    )
  }

  if (!username) {
    return (
      <main className="app-login h-screen w-full flex p-4 items-center justify-center">
        <div className="join-card w-full max-w-md">
          <div className="flex items-center justify-between mb-5">
            <h1 className="text-3xl font-bold">SyncStudio</h1>
            <ThemeToggle theme={theme} onToggle={toggleTheme} />
          </div>
          <p className="text-sm join-subtitle -mt-2 mb-5">
            Write documents and code together, in real time.
          </p>

          {authUser ? (
            <section className="account-panel">
              <div>
                <strong>Signed in</strong>
                <span>{authUser.displayName || authUser.email}</span>
              </div>
              <button type="button" className="account-secondary-button" onClick={handleSignOut}>
                Sign out
              </button>
            </section>
          ) : (
            <button type="button" className="google-sign-in-button" onClick={handleGoogleSignIn}>
              {firebaseConfigured ? "Continue with Google" : "Set up Google sign-in"}
            </button>
          )}
          {authError && <p className="auth-error" role="alert">{authError}</p>}

          {authUser && (
            <section className="my-documents" aria-label="My Documents">
              <div className="my-documents-heading">
                <h2>My Documents</h2>
                <button
                  type="button"
                  onClick={() => setDocumentsRefresh((current) => current + 1)}
                  disabled={documentsLoading}
                >
                  {documentsLoading ? "Refreshing…" : "Refresh"}
                </button>
              </div>
              {documentsError && <p className="auth-error" role="alert">{documentsError}</p>}
              {!documentsError && documentsLoading && <p className="join-subtitle">Loading documents…</p>}
              {!documentsError && !documentsLoading && documents.length === 0 && (
                <p className="join-subtitle">Rooms you create while signed in will appear here.</p>
              )}
              {documents.length > 0 && (
                <ul>
                  {documents.map((document) => (
                    <li key={document.room}>
                      <button
                        type="button"
                        className="recent-room-card"
                        onClick={() => openDocument(document)}
                      >
                        <span>{document.room}</span>
                        <small>Document</small>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          <form onSubmit={handleJoin} className="flex flex-col gap-4">
            <input
              type="text"
              name="username"
              value={joinName}
              onChange={(event) => {
                setJoinName(event.target.value)
                setRoomCreateError("")
              }}
              placeholder="Enter your username"
              autoComplete="off"
              maxLength={24}
              autoFocus
              required
              className="join-input"
            />

            <div className="flex items-center gap-2 text-sm text-gray-300">
              <input
                id="private-room-toggle"
                type="checkbox"
                checked={joinPrivateRoom}
                onChange={(event) => setJoinPrivateRoom(event.target.checked)}
              />
              <label htmlFor="private-room-toggle">Join private room</label>
            </div>

            {joinPrivateRoom && (
              <input
                type="password"
                name="joinPassword"
                value={joinPassword}
                onChange={(event) => setJoinPassword(event.target.value)}
                placeholder="Private room password"
                autoComplete="off"
                maxLength={128}
                className="join-input"
              />
            )}

            <input
              type="text"
              name="room"
              value={joinRoom}
              onChange={(event) => {
                setJoinRoom(event.target.value)
                setRoomCreateError("")
              }}
              placeholder="Room name"
              autoComplete="off"
              maxLength={40}
              className="join-input"
            />

            <button type="submit" className="join-button">Join room</button>
            <div className="flex flex-col gap-2">
              <label className="flex items-center gap-2 text-sm text-gray-300">
                <input
                  type="checkbox"
                  checked={privateRoom}
                  onChange={(event) => setPrivateRoom(event.target.checked)}
                />
                Create private room
              </label>
              {privateRoom && (
                <input
                  type="password"
                  value={roomPassword}
                  onChange={(event) => setRoomPassword(event.target.value)}
                  placeholder="Private room password (6+ characters)"
                  autoComplete="new-password"
                  maxLength={128}
                  className="join-input"
                />
              )}
              <button
                type="button"
                className="create-room-button"
                onClick={handleCreateRoom}
                disabled={roomCreating}
              >
                {roomCreating ? "Creating…" : "Create room with this name"}
              </button>
              <button
                type="button"
                className="create-room-button"
                onClick={handleGenerateRoom}
                disabled={roomCreating}
              >
                Generate a unique room name
              </button>
            </div>
            {roomCreateError && <p className="room-create-error" role="alert">{roomCreateError}</p>}
          </form>

          {recentRooms.length > 0 && (
            <section className="recent-rooms" aria-label="Recent rooms">
              <div className="flex items-center justify-between">
                <h2>Recent rooms</h2>
                <button type="button" onClick={clearRecentRooms}>Clear all</button>
              </div>
              <ul>
                {recentRooms.map((recent) => (
                  <li key={recent.room}>
                    <button type="button" className="recent-room-card" onClick={() => openRecentRoom(recent)}>
                      <span>{recent.room}</span>
                      <small>{recent.mode === "doc" ? "Document" : "Code"}</small>
                    </button>
                    <button
                      type="button"
                      className="remove-recent-room"
                      onClick={() => removeRecentRoom(recent.room)}
                      aria-label={`Remove ${recent.room} from recent rooms`}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
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
    <main className="app-shell h-screen w-full flex flex-col gap-3 p-4">

      {/* HEADER */}

      <header className="app-header no-print flex flex-wrap items-center gap-3 text-white">
        <h1 className="text-xl font-bold text-amber-50">SyncStudio</h1>

        <span className="px-2 py-1 rounded bg-gray-800 text-sm">
          room: <b>{room}</b>
        </span>

        <span className="flex items-center gap-2 text-sm text-gray-300">
          <span className={`w-2 h-2 rounded-full ${statusInfo.dot}`} />
          {statusInfo.label}
        </span>
        <span className="room-access-badge">
          {accessRole === null ? "Checking access…" : accessRole === "view" ? "View-only access" : "Edit access"}
        </span>

        <span className="text-sm text-gray-400 md:hidden">{users.length} online</span>

        <div className="app-header-actions ml-auto flex items-center gap-3">
          <div className="flex rounded-lg overflow-hidden border border-gray-700">
            {tab("doc", "Doc")}
            {tab("code", "Code")}
          </div>
          <button
            type="button"
            className="mobile-members-toggle md:hidden"
            aria-expanded={membersOpen}
            onClick={() => setMembersOpen((open) => !open)}
          >
            Members ({members.length || users.length})
          </button>

          {isOwner ? (
            <div className="share-menu" ref={shareMenuRef}>
              <button
                type="button"
                onClick={() => {
                  setShareError("")
                  setShareOpen((open) => !open)
                }}
                aria-expanded={shareOpen}
                className="px-3 py-1.5 rounded-lg border border-gray-700 text-sm hover:bg-gray-800"
              >
                {copied ? "Copied!" : "Share"}
              </button>
              {shareOpen && (
                <div className="share-popover">
                  <p>Creating either link requires a valid invite for future room joins. Links expire in 30 days.</p>
                  <button type="button" onClick={() => handleCopyLink("edit")} disabled={Boolean(shareBusy)}>
                    {shareBusy === "edit" ? "Creating…" : "Copy edit link"}
                  </button>
                  <button type="button" onClick={() => handleCopyLink("view")} disabled={Boolean(shareBusy)}>
                    {shareBusy === "view" ? "Creating…" : "Copy view-only link"}
                  </button>
                  {shareError && <p className="share-error" role="alert">{shareError}</p>}
                </div>
              )}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => handleCopyLink()}
              disabled={Boolean(shareBusy)}
              className="px-3 py-1.5 rounded-lg border border-gray-700 text-sm hover:bg-gray-800"
            >
              {copied === "link" ? "Copied!" : "Copy invite link"}
            </button>
          )}
          <ThemeToggle theme={theme} onToggle={toggleTheme} />
          {session && (
            <ChatSidebar
              ydoc={session.ydoc}
              user={session.user}
              clientId={session.provider.awareness.clientID}
              open={chatOpen}
              onToggle={() => setChatOpen((open) => !open)}
              readOnly={accessRole === "view"}
            />
          )}
          <div className="profile-menu" ref={profileMenuRef}>
            <button
              type="button"
              className="profile-trigger"
              onClick={() => {
                setProfileNameDraft(username)
                setProfileColorDraft(profileColor)
                setProfileError("")
                setProfileOpen((open) => !open)
              }}
            >
              Edit profile
            </button>
            {profileOpen && (
              <form className="profile-popover" onSubmit={saveProfile}>
                <label>
                  Display name
                  <input
                    value={profileNameDraft}
                    onChange={(event) => setProfileNameDraft(event.target.value)}
                    maxLength={24}
                    required
                  />
                </label>
                <label>
                  Cursor color
                  <input
                    type="color"
                    value={profileColorDraft}
                    onChange={(event) => setProfileColorDraft(event.target.value)}
                  />
                </label>
                {profileError && <p role="alert">{profileError}</p>}
                <div className="flex gap-2">
                  <button type="submit">Save</button>
                  <button type="button" onClick={() => setProfileOpen(false)}>Cancel</button>
                </div>
              </form>
            )}
          </div>
          <button
            type="button"
            className="profile-trigger"
            onClick={() => {
              setJoinName(username)
              setJoinRoom(room)
              setUsername("")
              setProfileOpen(false)
            }}
          >
            Home
          </button>
          <button
            type="button"
            className="profile-trigger"
            onClick={() => {
              setConfirmation({
                title: "Leave this room?",
                message: "You can rejoin later using the room link.",
                confirmLabel: "Leave room",
                onConfirm: () => {
                  leaveRoom()
                  setUsername("")
                },
              })
            }}
          >
            Leave room
          </button>
          {isOwner && (
            <button
              type="button"
              className="delete-room-button"
              onClick={() => {
                setConfirmation({
                  title: "Delete this room?",
                  message: `Permanently delete room "${room}" and its saved document?`,
                  confirmLabel: "Delete room",
                  danger: true,
                  onConfirm: deleteRoom,
                })
              }}
            >
              Delete room
            </button>
          )}
        </div>
      </header>

      {roomNotice && (
        <div className="room-notice" role="status">
          <span>{roomNotice}</span>
          {!isOwner && (
            <button type="button" onClick={() => setUsername("")}>Return home</button>
          )}
        </div>
      )}

      <div className="app-workspace flex flex-1 min-h-0 gap-4">

        {/* USERS */}

        <aside
          className={`app-users no-print h-full w-56 shrink-0 rounded-lg overflow-auto ${
            membersOpen ? "mobile-members-open" : "hidden md:block"
          }`}
          aria-label="Room members"
        >
          <h2 className="text-xl font-bold p-4 border-b border-gray-300">
            Members ({members.length || users.length})
          </h2>
          <button
            type="button"
            className="mobile-members-close md:hidden"
            onClick={() => setMembersOpen(false)}
          >
            Close
          </button>

          <ul className="p-4">
            {(members.length ? members : users).map((user) => (
              <li
                key={user.socketId || user.clientId}
                className="room-member p-2 rounded mb-2 flex items-center gap-2"
              >
                <span
                  className="w-3 h-3 rounded-full shrink-0"
                  style={{ backgroundColor: user.color }}
                />
                <span className="truncate">{user.name}</span>
                {user.userId === ownerId && <span className="text-xs room-owner-badge">owner</span>}
                {user.access === "view" && <span className="text-xs room-you-badge">view-only</span>}
                {user.socketId === selfSocketId && <span className="ml-auto text-xs room-you-badge">you</span>}
                {isOwner && user.socketId !== selfSocketId && user.userId !== ownerId && (
                  <button
                    type="button"
                    className="kick-member-button"
                    aria-label={`Remove ${user.name} from room`}
                    onClick={() => {
                      setConfirmation({
                        title: `Remove ${user.name}?`,
                        message: `${user.name} will be disconnected from this room.`,
                        confirmLabel: "Remove",
                        danger: true,
                        onConfirm: () => kickMember(user.socketId),
                      })
                    }}
                  >
                    Kick
                  </button>
                )}
              </li>
            ))}
          </ul>
        </aside>

        {/* EDITOR */}

        <section className="app-editor flex-1 min-w-0 bg-neutral-800 rounded-lg overflow-hidden">
          {!session || accessRole === null ? (
            loading
          ) : (
            <Suspense fallback={loading}>
              {mode === "code" ? (
                <CodeEditor
                  key={`code-${room}`}
                  ydoc={session.ydoc}
                  provider={session.provider}
                  user={session.user}
                  theme={theme}
                  readOnly={accessRole === "view"}
                  autoSaveEnabled={autoSaveEnabled}
                />
              ) : (
                <DocEditor
                  key={`doc-${room}`}
                  ydoc={session.ydoc}
                  provider={session.provider}
                  user={session.user}
                  room={room}
                  readOnly={accessRole === "view"}
                  autoSaveEnabled={autoSaveEnabled}
                />
              )}
            </Suspense>
          )}
        </section>

      </div>
      {confirmation && (
        <ConfirmDialog
          title={confirmation.title}
          message={confirmation.message}
          confirmLabel={confirmation.confirmLabel}
          danger={confirmation.danger}
          onCancel={() => setConfirmation(null)}
          onConfirm={() => {
            confirmation.onConfirm()
            setConfirmation(null)
          }}
        />
      )}
      {shareFallbackLink && (
        <div
          className="dialog-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setShareFallbackLink("")
          }}
        >
          <section
            className="confirm-dialog share-link-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="share-link-dialog-title"
          >
            <h2 id="share-link-dialog-title">Copy invite link</h2>
            <p>Clipboard access is unavailable. Select and copy the link below.</p>
            <input
              ref={shareFallbackInputRef}
              type="text"
              readOnly
              value={shareFallbackLink}
              onFocus={(event) => event.target.select()}
              aria-label="Invite link"
            />
            <div className="confirm-dialog-actions">
              <button type="button" onClick={() => setShareFallbackLink("")}>Close</button>
              <button
                type="button"
                onClick={() => shareFallbackInputRef.current?.select()}
              >
                Select link
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  )
}

export default App
