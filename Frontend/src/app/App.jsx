
import "./App.css"
import { Editor } from "@monaco-editor/react"
import { MonacoBinding } from "y-monaco"
import { useRef, useMemo, useState, useEffect } from "react"
import * as Y from "yjs"
import { SocketIOProvider } from "y-socket.io"

function App() {

  const editorRef = useRef(null)
  const providerRef = useRef(null)
  const bindingRef = useRef(null)

  const [username, setUsername] = useState(() => {
    return (
      new URLSearchParams(window.location.search).get("username") || ""
    )
  })

  const [users, setUsers] = useState([])

  const ydoc = useMemo(() => new Y.Doc(), [])
  const yText = useMemo(() => ydoc.getText("monaco"), [ydoc])


  // -----------------------------
  // EDITOR MOUNT
  // -----------------------------

 const handleMount = (editor) => {
  editorRef.current = editor

  const provider = new SocketIOProvider(
    import.meta.env.VITE_CONNECT,
    "my-roomname",
    ydoc,
    {
      autoConnect: true
    }
  )

  providerRef.current = provider

  // Current user ko awareness me add karo
  provider.awareness.setLocalStateField("user", {
    username
  })

  // Users update karne ka function
  const updateUsers = () => {
    const states = Array.from(
      provider.awareness.getStates().values()
    )

    const currentUsers = states
      .filter(
        state =>
          state.user &&
          state.user.username
      )
      .map(state => state.user)

    console.log("Users:", currentUsers)

    setUsers(currentUsers)
  }

  // Initially users dikhao
  updateUsers()

  // Jab koi user join/leave kare
  provider.awareness.on("change", updateUsers)

  // Monaco + Yjs binding
  const binding = new MonacoBinding(
    yText,
    editor.getModel(),
    new Set([editor]),
    provider.awareness
  )

  bindingRef.current = binding
}

  // -----------------------------
  // JOIN
  // -----------------------------

  const handleJoin = (e) => {

    e.preventDefault()

    const name = e.target.username.value.trim()


    // Empty username
    if (!name) {
      alert("Please enter a username")
      return
    }


    // Duplicate username check
    const alreadyExists = users.some(
      user =>
        user.username.toLowerCase() === name.toLowerCase()
    )


    if (alreadyExists) {
      alert("Username already taken")
      return
    }


    // Set username
    setUsername(name)


    // Update URL
    window.history.pushState(
      {},
      "",
      "?username=" + encodeURIComponent(name)
    )
  }


  // -----------------------------
  // AWARENESS / USERS
  // -----------------------------

  useEffect(() => {

    const provider = providerRef.current

    if (!provider || !username) {
      return
    }


    // Set current user
    provider.awareness.setLocalStateField("user", {
      username
    })


    // Get users
    const updateUsers = () => {

      const states = Array.from(
        provider.awareness.getStates().values()
      )

      const currentUsers = states
        .filter(
          state =>
            state.user &&
            state.user.username
        )
        .map(state => state.user)


      setUsers(currentUsers)
    }


    // Initial users
    updateUsers()


    // Listen for users joining/leaving
    provider.awareness.on(
      "change",
      updateUsers
    )


    // Remove user before closing tab
    const handleBeforeUnload = () => {

      provider.awareness.setLocalStateField(
        "user",
        null
      )
    }

    window.addEventListener(
      "beforeunload",
      handleBeforeUnload
    )


    // Cleanup
    return () => {

      provider.awareness.off(
        "change",
        updateUsers
      )

      window.removeEventListener(
        "beforeunload",
        handleBeforeUnload
      )
    }

  }, [username])


  // -----------------------------
  // COMPLETE CLEANUP
  // -----------------------------

  useEffect(() => {

    return () => {

      bindingRef.current?.destroy()

      providerRef.current?.destroy()

      ydoc.destroy()
    }

  }, [ydoc])


  // -----------------------------
  // LOGIN SCREEN
  // -----------------------------

  if (!username) {

    return (
      <main
        className="
          h-screen
          w-full
          bg-gray-950
          flex
          p-4
          items-center
          justify-center
        "
      >

        <form
          onSubmit={handleJoin}
          className="flex flex-col gap-4"
        >

          <input
            type="text"
            placeholder="Enter your username"
            className="
              p-2
              rounded-lg
              bg-gray-800
              text-white
              outline-none
            "
            name="username"
            autoComplete="off"
          />


          <button
            type="submit"
            className="
              p-2
              rounded-lg
              bg-amber-50
              text-gray-950
              font-bold
            "
          >
            Join
          </button>

        </form>

      </main>
    )
  }


  // -----------------------------
  // EDITOR SCREEN
  // -----------------------------

  return (

    <main
      className="
        h-screen
        w-full
        bg-gray-950
        flex
        gap-4
        p-4
      "
    >

      {/* USERS */}

      <aside
        className="
          h-full
          w-1/4
          bg-amber-50
          rounded-lg
          overflow-hidden
        "
      >

        <h2
          className="
            text-2xl
            font-bold
            p-4
            border-b
            border-gray-300
          "
        >
          Users
        </h2>


        <ul className="p-4">

          {users.map((user, index) => (

            <li
              key={index}
              className="
                p-2
                bg-gray-800
                text-white
                rounded
                mb-2
              "
            >
              {user.username}
            </li>

          ))}

        </ul>

      </aside>


      {/* MONACO EDITOR */}

      <section
        className="
          w-3/4
          bg-neutral-800
          rounded-lg
          overflow-hidden
        "
      >

        <Editor
          height="100%"
          defaultLanguage="javascript"
          defaultValue="// some comment"
          theme="vs-dark"
          onMount={handleMount}
        />

      </section>

    </main>
  )
}

export default App
