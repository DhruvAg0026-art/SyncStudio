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

const backendPath = fileURLToPath(new URL("../server.js", import.meta.url))
let backend
let dataDirectory
let baseUrl

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
  throw new Error("Backend did not become healthy in time.")
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
    stdio: "ignore",
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
  assert.deepEqual(await namedResponse.json(), { room: "test-room-name" })

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
