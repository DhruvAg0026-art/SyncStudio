import { useEffect, useRef, useState } from "react"

function renderMessage(text) {
  return text.split(/(https?:\/\/[^\s]+)/g).map((part, index) => {
    if (!/^https?:\/\//i.test(part)) return part
    try {
      const url = new URL(part)
      if (!["http:", "https:"].includes(url.protocol)) return part
      return (
        <a key={`${index}-${part}`} href={url.href} target="_blank" rel="noreferrer">
          {part}
        </a>
      )
    } catch {
      return part
    }
  })
}

export default function ChatSidebar({ ydoc, user, clientId, open, onToggle, readOnly = false }) {
  const [messages, setMessages] = useState([])
  const [draft, setDraft] = useState("")
  const [unread, setUnread] = useState(0)
  const containerRef = useRef(null)
  const stickToBottomRef = useRef(true)
  const openRef = useRef(open)
  const clientIdRef = useRef(clientId)
  const readOnlyRef = useRef(readOnly)
  openRef.current = open
  clientIdRef.current = clientId
  readOnlyRef.current = readOnly

  useEffect(() => {
    if (!ydoc) return
    const chat = ydoc.getArray("chat")
    let initialized = false
    let seenIds = new Set()

    const updateMessages = () => {
      if (!readOnlyRef.current && chat.length > 200) {
        ydoc.transact(() => chat.delete(0, chat.length - 200))
      }

      const nextMessages = chat.toArray().filter((message) =>
        message
        && typeof message.id === "string"
        && typeof message.text === "string"
        && typeof message.author === "string"
        && Number.isFinite(message.createdAt)
      )
      if (!initialized) {
        initialized = true
        seenIds = new Set(nextMessages.map((message) => message.id))
        setMessages(nextMessages)
        return
      }
      const newMessages = nextMessages.filter((message) => !seenIds.has(message.id))
      const unseenIncoming = newMessages.filter((message) => message.clientId !== clientIdRef.current)
      if (!openRef.current && unseenIncoming.length) {
        setUnread((count) => count + unseenIncoming.length)
      }
      seenIds = new Set(nextMessages.map((message) => message.id))
      setMessages(nextMessages)
    }

    chat.observe(updateMessages)
    updateMessages()
    return () => chat.unobserve(updateMessages)
  }, [ydoc])

  useEffect(() => {
    if (open && stickToBottomRef.current && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight
    }
  }, [messages, open])

  useEffect(() => {
    if (open) setUnread(0)
  }, [open])

  const sendMessage = (event) => {
    event.preventDefault()
    if (readOnly) return
    const text = draft.trim()
    if (!text || !ydoc || text.length > 2000) return

    const chat = ydoc.getArray("chat")
    ydoc.transact(() => {
      chat.push([{
        id: crypto.randomUUID(),
        text,
        author: user?.name || "Guest",
        color: user?.color || "#fbbf24",
        clientId,
        createdAt: Date.now(),
      }])
      if (chat.length > 200) chat.delete(0, chat.length - 200)
    })
    setDraft("")
  }

  const handleScroll = () => {
    if (!containerRef.current) return
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current
    stickToBottomRef.current = scrollHeight - scrollTop - clientHeight < 60
  }

  return (
    <>
      <button type="button" className="chat-toggle" onClick={onToggle} aria-expanded={open}>
        Chat{unread > 0 && !open && <span className="chat-unread">{unread > 99 ? "99+" : unread}</span>}
      </button>
      {open && (
        <aside className="chat-panel" aria-label="Room chat">
          <div className="chat-panel-header">
            <h2>Room chat</h2>
            <button type="button" onClick={onToggle} aria-label="Close chat">×</button>
          </div>
          <div className="chat-messages" ref={containerRef} onScroll={handleScroll}>
            {messages.map((message) => (
              <article className="chat-message" key={message.id}>
                <div className="chat-message-meta">
                  <span style={{ color: message.color }}>{message.author}</span>
                  <time dateTime={new Date(message.createdAt).toISOString()}>
                    {new Date(message.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </time>
                </div>
                <p>{renderMessage(message.text)}</p>
              </article>
            ))}
            <div />
          </div>
          {!readOnly && (
            <form className="chat-compose" onSubmit={sendMessage}>
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault()
                    event.currentTarget.form.requestSubmit()
                  }
                }}
                maxLength={2000}
                placeholder="Message (Enter to send)"
                rows={3}
              />
              <button type="submit" disabled={!draft.trim()}>Send</button>
            </form>
          )}
        </aside>
      )}
    </>
  )
}
