import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { once } from "node:events"
import { createServer } from "node:net"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { after, before, test } from "node:test"
import { randomBytes } from "node:crypto"
import { io as connectSocket } from "socket.io-client"
import * as Y from "yjs"

const backendPath = fileURLToPath(new URL("../server.js", import.meta.url))
let backend
let dataDirectory
let baseUrl
let startupOutput = ""

async function getFreePort() {
  const listener = createServer()
  await new Promise((resolve, reject) => {
    listener.once("error", reject)
    listener.listen(0, "127.0.0.1", resolve)
  })
  const { port } = listener.address()
  await new Promise((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()))
  return port
}

async function waitForServer() {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    if (backend.exitCode !== null) throw new Error(`Backend exited with code ${backend.exitCode}.`)
    try {
      const response = await fetch(`${baseUrl}/health`)
      if (response.ok) return
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }
  throw new Error(`Backend did not become healthy in time.\n${startupOutput.slice(-4000)}`)
}

before(async () => {
  const port = await getFreePort()
  dataDirectory = await mkdtemp(join(tmpdir(), "syncstudio-backend-test-"))
  baseUrl = `http://127.0.0.1:${port}`
  backend = spawn(process.execPath, [backendPath], {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    env: {
      ...process.env,
      PORT: String(port),
      CLIENT_ORIGIN: "http://localhost:5173",
      ROOM_SECRET: randomBytes(32).toString("hex"),
      DATA_DIR: join(dataDirectory, "data"),
      FIREBASE_SERVICE_ACCOUNT_JSON: "",
      NODE_ENV: "test",
    },
    stdio: ["ignore", "pipe", "pipe"],
  })
  backend.stdout.setEncoding("utf8")
  backend.stderr.setEncoding("utf8")
  backend.stdout.on("data", (output) => {
    startupOutput += output
  })
  backend.stderr.on("data", (output) => {
    startupOutput += output
  })
  await waitForServer()
})

after(async () => {
  if (backend && backend.exitCode === null) {
    const exited = once(backend, "exit")
    backend.kill()
    await exited
  }
  if (dataDirectory) await rm(dataDirectory, { recursive: true, force: true })
})

test("room creation rejects used names and generates unique readable names", async () => {
  const sessionResponse = await fetch(`${baseUrl}/api/session`, { method: "POST" })
  assert.equal(sessionResponse.status, 201)
  const session = await sessionResponse.json()
  assert.ok(session.token)
  assert.ok(session.expiresAt > Date.now())

  const headers = {
    authorization: `Bearer ${session.token}`,
    "content-type": "application/json",
  }
  const createRoom = (body) => fetch(`${baseUrl}/api/rooms`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  })

  const namedResponse = await createRoom({ room: "test-room-name" })
  assert.equal(namedResponse.status, 201)
  assert.deepEqual(await namedResponse.json(), { room: "test-room-name", privateRoom: false })

  const duplicateResponse = await createRoom({ room: "test-room-name" })
  assert.equal(duplicateResponse.status, 409)

  const generatedResponse = await createRoom({})
  assert.equal(generatedResponse.status, 201)
  const generated = await generatedResponse.json()
  assert.match(generated.room, /^[a-z]+-[a-z]+-[a-f0-9]{6}$/)
  assert.notEqual(generated.room, "test-room-name")

  const invalidResponse = await createRoom({ room: "invalid room" })
  assert.equal(invalidResponse.status, 400)
})

test("guest sessions work while Firebase-only endpoints fail explicitly", async () => {
  const session = await (await fetch(`${baseUrl}/api/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  })).json()

  const firebaseResponse = await fetch(`${baseUrl}/api/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ idToken: "invalid-test-token" }),
  })
  assert.equal(firebaseResponse.status, 503)

  const documentsResponse = await fetch(`${baseUrl}/api/documents`, {
    headers: { authorization: `Bearer ${session.token}` },
  })
  assert.equal(documentsResponse.status, 403)
})

test("only the room owner can issue signed, access-scoped invite links", async () => {
  const createSession = async () => {
    const response = await fetch(`${baseUrl}/api/session`, { method: "POST" })
    assert.equal(response.status, 201)
    return response.json()
  }
  const ownerSession = await createSession()
  const otherSession = await createSession()
  const room = `invite-test-${randomBytes(3).toString("hex")}`
  const roomResponse = await fetch(`${baseUrl}/api/rooms`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${ownerSession.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ room }),
  })
  assert.equal(roomResponse.status, 201)

  const createInvite = (token, access) => fetch(`${baseUrl}/api/rooms/${room}/invites`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ access }),
  })

  const unauthorized = await fetch(`${baseUrl}/api/rooms/${room}/invites`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ access: "view" }),
  })
  assert.equal(unauthorized.status, 401)

  const forbidden = await createInvite(otherSession.token, "edit")
  assert.equal(forbidden.status, 403)

  const invalidAccess = await createInvite(ownerSession.token, "admin")
  assert.equal(invalidAccess.status, 400)

  for (const access of ["view", "edit"]) {
    const response = await createInvite(ownerSession.token, access)
    assert.equal(response.status, 201)
    const invite = await response.json()
    const claims = JSON.parse(Buffer.from(invite.inviteToken.split(".")[0], "base64url").toString())
    assert.equal(claims.kind, "room-invite")
    assert.equal(claims.room, room)
    assert.equal(claims.access, access)
    assert.equal(claims.ownerId, JSON.parse(Buffer.from(ownerSession.token.split(".")[0], "base64url").toString()).sub)
    assert.ok(invite.expiresAt > Date.now())
  }
})

test("invite roles are enforced during socket authorization and document synchronization", async () => {
  const createSession = async () => {
    const response = await fetch(`${baseUrl}/api/session`, { method: "POST" })
    assert.equal(response.status, 201)
    return response.json()
  }
  const ownerSession = await createSession()
  const viewerSession = await createSession()
  const editorSession = await createSession()
  const room = `invite-sync-${randomBytes(3).toString("hex")}`
  const roomResponse = await fetch(`${baseUrl}/api/rooms`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${ownerSession.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ room }),
  })
  assert.equal(roomResponse.status, 201)

  const createInvite = async (access) => {
    const response = await fetch(`${baseUrl}/api/rooms/${room}/invites`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${ownerSession.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ access }),
    })
    assert.equal(response.status, 201)
    return (await response.json()).inviteToken
  }
  const viewInvite = await createInvite("view")
  const editInvite = await createInvite("edit")
  const connect = (sessionToken, inviteToken) => connectSocket(`${baseUrl}/yjs|${room}`, {
    autoConnect: false,
    reconnection: false,
    auth: { sessionToken, inviteToken },
  })
  const waitForConnect = (socket) => new Promise((resolve, reject) => {
    socket.once("connect", resolve)
    socket.once("connect_error", reject)
    socket.connect()
  })

  const sockets = []
  try {
    const directSocket = connect(viewerSession.token)
    sockets.push(directSocket)
    const rejected = new Promise((resolve) => directSocket.once("connect_error", resolve))
    directSocket.connect()
    const rejection = await rejected
    assert.match(rejection.message, /valid invite link/)

    const viewerSocket = connect(viewerSession.token, viewInvite)
    const ownerSocket = connect(ownerSession.token)
    const editorSocket = connect(editorSession.token, editInvite)
    sockets.push(viewerSocket, ownerSocket, editorSocket)
    await Promise.all([waitForConnect(viewerSocket), waitForConnect(ownerSocket), waitForConnect(editorSocket)])
    const joinRoom = (socket, name) => new Promise((resolve) => {
      socket.emit("room:join", { name, color: "#60a5fa" }, resolve)
    })
    assert.equal((await joinRoom(ownerSocket, "Owner")).state.ownerId, JSON.parse(
      Buffer.from(ownerSession.token.split(".")[0], "base64url").toString()
    ).sub)
    assert.equal((await joinRoom(viewerSocket, "Viewer")).state.members[1].access, "view")
    assert.equal((await joinRoom(editorSocket, "Editor")).state.members[2].access, "edit")

    const received = []
    const observer = new Y.Doc()
    ownerSocket.on("sync-update", (update) => {
      Y.applyUpdate(observer, new Uint8Array(update))
      received.push(update)
    })

    const viewerUpdate = new Y.Doc()
    viewerUpdate.getText("invite-check").insert(0, "viewer edit")
    viewerSocket.emit("sync-update", Y.encodeStateAsUpdate(viewerUpdate))
    await new Promise((resolve) => setTimeout(resolve, 150))
    assert.equal(received.length, 0)
    assert.equal(observer.getText("invite-check").toString(), "")

    const editorUpdate = new Y.Doc()
    editorUpdate.getText("invite-check").insert(0, "editor edit")
    editorSocket.emit("sync-update", Y.encodeStateAsUpdate(editorUpdate))
    const deadline = Date.now() + 3000
    while (!observer.getText("invite-check").length && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    assert.equal(observer.getText("invite-check").toString(), "editor edit")

    const transferredState = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Ownership transfer was not broadcast.")), 3000)
      const onState = (state) => {
        if (state.ownerId !== JSON.parse(
          Buffer.from(viewerSession.token.split(".")[0], "base64url").toString()
        ).sub) return
        clearTimeout(timeout)
        resolve(state)
      }
      editorSocket.on("room:state", onState)
    })
    ownerSocket.disconnect()
    const newState = await transferredState
    assert.equal(
      newState.members.find((member) => member.userId === newState.ownerId).access,
      "edit"
    )

    const staleInviteSocket = connect(editorSession.token, editInvite)
    sockets.push(staleInviteSocket)
    const staleInviteRejection = new Promise((resolve) => {
      staleInviteSocket.once("connect_error", resolve)
    })
    staleInviteSocket.connect()
    assert.match((await staleInviteRejection).message, /valid invite link/)
  } finally {
    for (const socket of sockets) socket.disconnect()
  }
})

test("private rooms require a password and accept the issued room access token", async () => {
  const createSession = async () => {
    const response = await fetch(`${baseUrl}/api/session`, { method: "POST" })
    assert.equal(response.status, 201)
    return response.json()
  }
  const ownerSession = await createSession()
  const guestSession = await createSession()
  const room = `private-${randomBytes(4).toString("hex")}`
  const createResponse = await fetch(`${baseUrl}/api/rooms`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${ownerSession.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ room, privateRoom: true, password: "correct-horse" }),
  })
  assert.equal(createResponse.status, 201)
  assert.deepEqual(await createResponse.json(), { room, privateRoom: true })

  const accessUrl = `${baseUrl}/api/rooms/${room}/access`
  const wrongPassword = await fetch(accessUrl, {
    method: "POST",
    headers: {
      authorization: `Bearer ${guestSession.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ password: "incorrect" }),
  })
  assert.equal(wrongPassword.status, 401)

  const accessResponse = await fetch(accessUrl, {
    method: "POST",
    headers: {
      authorization: `Bearer ${guestSession.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ password: "correct-horse" }),
  })
  assert.equal(accessResponse.status, 200)
  const { roomAccessToken } = await accessResponse.json()
  assert.ok(roomAccessToken)

  const socket = connectSocket(`${baseUrl}/yjs|${room}`, {
    autoConnect: false,
    reconnection: false,
    auth: { sessionToken: guestSession.token, roomAccessToken },
  })
  try {
    await new Promise((resolve, reject) => {
      socket.once("connect", resolve)
      socket.once("connect_error", reject)
      socket.connect()
    })
    const joined = await new Promise((resolve) => {
      socket.emit("room:join", { name: "Private guest", color: "#60a5fa" }, resolve)
    })
    assert.equal(joined.error, undefined)
    assert.ok(joined.state.members.some((member) => member.name === "Private guest"))
  } finally {
    socket.disconnect()
  }
})
