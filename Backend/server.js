import "dotenv/config";
import { randomUUID, randomInt, createHmac, timingSafeEqual } from "crypto";
import express from "express";
import { createServer } from "http";
import cors from "cors";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { Server } from "socket.io";
import * as Y from "yjs";
import { YSocketIO } from "y-socket.io/dist/server";
import { getApps, initializeApp, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

const app = express();
const httpServer = createServer(app);
const port = Number(process.env.PORT) || 3000;
const isProduction = process.env.NODE_ENV === "production";

if (isProduction && !process.env.CLIENT_ORIGIN) {
  throw new Error("CLIENT_ORIGIN must be set in production.");
}
if (isProduction && !process.env.ROOM_SECRET) {
  throw new Error("ROOM_SECRET must be set in production.");
}

const clientOrigins = (process.env.CLIENT_ORIGIN || "http://localhost:5173")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const roomSecret = process.env.ROOM_SECRET || randomUUID();
const maxCodeBytes = 20 * 1024;
const maxUpdateBytes = 1024 * 1024;
const maxDocumentBytes = 10 * 1024 * 1024;
const validRoom = (room) => typeof room === "string" && /^[a-z0-9_-]{1,40}$/.test(room);
const log = (level, event, details = {}) => {
  const write = level === "error" ? console.error : level === "warn" ? console.warn : console.info;
  write(JSON.stringify({ timestamp: new Date().toISOString(), level, event, ...details }));
};

let firebaseAuth = null;
let firestore = null;
if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  const adminApp = getApps().length
    ? getApps()[0]
    : initializeApp({
      credential: cert(serviceAccount),
      projectId: process.env.FIREBASE_PROJECT_ID || serviceAccount.project_id,
    });
  firebaseAuth = getAuth(adminApp);
  firestore = getFirestore(adminApp);
}

app.disable("x-powered-by");
app.use(helmet());
app.use(cors({
  origin(origin, callback) {
    if (!origin || clientOrigins.includes(origin)) return callback(null, true);
    return callback(new Error("Origin is not allowed by CORS."));
  },
}));
app.use(express.json({ limit: "25kb" }));

const io = new Server(httpServer, {
  cors: {
    origin: clientOrigins,
  },
});

function signPayload(payload) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", roomSecret).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

function verifyPayload(token) {
  if (typeof token !== "string") return null;
  const [encoded, suppliedSignature, extra] = token.split(".");
  if (!encoded || !suppliedSignature || extra) return null;
  const expected = createHmac("sha256", roomSecret).update(encoded).digest();
  let actual;
  try {
    actual = Buffer.from(suppliedSignature, "base64url");
  } catch {
    return null;
  }
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    return payload.exp > Date.now() ? payload : null;
  } catch {
    return null;
  }
}

const sessionLimit = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
});

const createRoomLimit = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
});

const createInviteLimit = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
});

app.get("/", (_req, res) => {
  res.status(200).json({ message: "Hello World!", success: true });
});

app.get("/health", (_req, res) => {
  res.status(200).json({ message: "Server is healthy", success: true });
});

app.post("/api/session", sessionLimit, async (req, res) => {
  let userId = randomUUID();
  let provider = "guest";
  if (req.body?.idToken !== undefined) {
    if (typeof req.body.idToken !== "string" || !req.body.idToken) {
      return res.status(400).json({ error: "A valid Firebase ID token is required." });
    }
    if (!firebaseAuth) {
      return res.status(503).json({ error: "Google sign-in is not configured on the backend." });
    }
    try {
      const identity = await firebaseAuth.verifyIdToken(req.body.idToken);
      userId = identity.uid;
      provider = "firebase";
    } catch (error) {
      log("warn", "auth.firebase_token_rejected", { message: error.message });
      return res.status(401).json({ error: "Google sign-in could not be verified." });
    }
  }
  const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
  return res.status(201).json({
    token: signPayload({ sub: userId, provider, exp: expiresAt }),
    expiresAt,
  });
});

const roomNameParts = [
  "amber", "birch", "cedar", "coral", "maple", "river", "solar", "willow",
];
const roomLocks = new Map();

async function withRoomLock(room, operation) {
  const previous = roomLocks.get(room) || Promise.resolve();
  let release;
  const current = new Promise((resolve) => {
    release = resolve;
  });
  roomLocks.set(room, current);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (roomLocks.get(room) === current) roomLocks.delete(room);
  }
}

async function roomNameIsTaken(room) {
  if (await ySocketIO.persistence?.provider?.getMeta(room, "deleted")) return true;
  if (ySocketIO.documents.has(room)) return true;
  if (roomStates.has(room)) {
    const state = await roomStates.get(room);
    if (state.deleted || state.ownerId || state.members.length) return true;
  }
  const metadata = await ySocketIO.persistence?.provider?.getMetas(room);
  return Boolean(metadata?.size);
}

async function reserveRoomName(requestedRoom, ownerId) {
  if (requestedRoom) {
    if (!validRoom(requestedRoom)) {
      const error = new Error("Room names must use 1-40 letters, numbers, dashes, or underscores.");
      error.status = 400;
      throw error;
    }
    return withRoomLock(requestedRoom, async () => {
      if (await roomNameIsTaken(requestedRoom)) {
        const error = new Error("That room name is already in use. Try another name or join the existing room.");
        error.status = 409;
        throw error;
      }
      await ySocketIO.persistence?.provider?.setMeta(requestedRoom, "created", true);
      await ySocketIO.persistence?.provider?.setMeta(requestedRoom, "ownerId", ownerId);
      return requestedRoom;
    });
  }

  for (let attempt = 0; attempt < 20; attempt++) {
    const first = roomNameParts[randomInt(roomNameParts.length)];
    const second = roomNameParts[randomInt(roomNameParts.length)];
    const candidate = `${first}-${second}-${randomUUID().slice(0, 6)}`;
    try {
      const reserved = await withRoomLock(candidate, async () => {
        if (await roomNameIsTaken(candidate)) return null;
        await ySocketIO.persistence?.provider?.setMeta(candidate, "created", true);
        await ySocketIO.persistence?.provider?.setMeta(candidate, "ownerId", ownerId);
        return candidate;
      });
      if (reserved) return reserved;
    } catch (error) {
      if (error.status !== 409) throw error;
    }
  }
  throw new Error("Could not generate an available room name. Please try again.");
}

app.post("/api/rooms", createRoomLimit, async (req, res, next) => {
  const authorization = req.get("authorization") || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  const session = verifyPayload(token);
  if (!session?.sub) return res.status(401).json({ error: "A valid room session is required." });

  const room = req.body?.room;
  if (room !== undefined && typeof room !== "string") {
    return res.status(400).json({ error: "Room name must be text." });
  }
  if (room !== undefined && !room.trim()) {
    return res.status(400).json({ error: "Room name cannot be empty." });
  }
  try {
    const reservedRoom = await reserveRoomName(room?.trim().toLowerCase(), session.sub);
    return res.status(201).json({ room: reservedRoom });
  } catch (error) {
    if (error.status === 400 || error.status === 409) {
      return res.status(error.status).json({ error: error.message });
    }
    return next(error);
  }
});

app.post("/api/rooms/:room/invites", createInviteLimit, async (req, res, next) => {
  const session = getRequestSession(req);
  if (!session?.sub) return res.status(401).json({ error: "A valid room session is required." });

  const { room } = req.params;
  const { access } = req.body || {};
  if (!validRoom(room) || !["edit", "view"].includes(access)) {
    return res.status(400).json({ error: "Choose a valid room and invite access level." });
  }

  try {
    const state = await getRoomState(room);
    if (state.deleted) return res.status(404).json({ error: "This room no longer exists." });
    if (state.ownerId !== session.sub) {
      return res.status(403).json({ error: "Only the room owner can create invite links." });
    }

    state.inviteRequired = true;
    await ySocketIO.persistence?.provider?.setMeta(room, "inviteRequired", true);
    const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
    const inviteToken = signPayload({
      kind: "room-invite",
      room,
      access,
      ownerId: state.ownerId,
      version: state.accessVersion,
      exp: expiresAt,
    });
    return res.status(201).json({ inviteToken, access, expiresAt });
  } catch (error) {
    return next(error);
  }
});

function getRequestSession(req) {
  const authorization = req.get("authorization") || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  return verifyPayload(token);
}

async function saveDocumentOwner(room, ownerUid) {
  if (!firestore) throw new Error("Firestore is not configured on the backend.");
  const reference = firestore.collection("documents").doc(room);
  const current = await reference.get();
  const data = {
    room,
    ownerUid,
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (!current.exists) data.createdAt = FieldValue.serverTimestamp();
  await reference.set(data, { merge: true });
}

app.get("/api/documents", sessionLimit, async (req, res, next) => {
  const session = getRequestSession(req);
  if (!session?.sub || session.provider !== "firebase") {
    return res.status(403).json({ error: "Sign in with Google to view your documents." });
  }
  if (!firestore) {
    return res.status(503).json({ error: "My Documents storage is not configured on the backend." });
  }
  try {
    const snapshot = await firestore.collection("documents")
      .where("ownerUid", "==", session.sub)
      .limit(100)
      .get();
    const documents = snapshot.docs
      .map((document) => {
        const data = document.data();
        return {
          room: data.room,
          updatedAt: data.updatedAt?.toDate?.().toISOString() || null,
        };
      })
      .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
    return res.status(200).json({ documents });
  } catch (error) {
    return next(error);
  }
});

const pistonRuntimes = {
  javascript: { language: "javascript", version: "18.15.0" },
  typescript: { language: "typescript", version: "5.0.3" },
  python: { language: "python", version: "3.10.0" },
  java: { language: "java", version: "15.0.2" },
  c: { language: "c", version: "10.2.0" },
  cpp: { language: "c++", version: "10.2.0" },
  csharp: { language: "csharp", version: "6.12.0" },
  go: { language: "go", version: "1.16.2" },
  rust: { language: "rust", version: "1.68.2" },
  php: { language: "php", version: "8.2.3" },
  ruby: { language: "ruby", version: "3.0.1" },
  swift: { language: "swift", version: "5.3.3" },
  kotlin: { language: "kotlin", version: "1.8.20" },
  dart: { language: "dart", version: "2.19.6" },
  lua: { language: "lua", version: "5.4.4" },
};

app.post("/run", rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
}), async (req, res) => {
  const { code, language, stdin = "" } = req.body || {};
  const runtime = pistonRuntimes[language];
  if (!runtime) {
    return res.status(400).json({ error: "This language is not supported by the code runner." });
  }
  if (typeof code !== "string" || Buffer.byteLength(code, "utf8") > maxCodeBytes) {
    return res.status(413).json({ error: "Code must be a string no larger than 20 KB." });
  }
  if (typeof stdin !== "string" || Buffer.byteLength(stdin, "utf8") > maxCodeBytes) {
    return res.status(413).json({ error: "Input must be a string no larger than 20 KB." });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(process.env.PISTON_API_URL || "https://emkc.org/api/v2/piston/execute", {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        ...runtime,
        files: [{ content: code }],
        stdin,
        compile_timeout: 10_000,
        run_timeout: 5_000,
        compile_memory_limit: 128_000_000,
        run_memory_limit: 128_000_000,
      }),
    });
    if (!response.ok) {
      log("error", "code_runner.provider_rejected", { status: response.status });
      return res.status(502).json({
        error: "The configured execution service rejected the request. Set PISTON_API_URL to an accessible Piston-compatible endpoint.",
      });
    }

    const result = await response.json();
    const runResult = result.run || result.compile || {};
    return res.status(200).json({
      stdout: String(runResult.stdout || "").slice(0, 64 * 1024),
      stderr: String(runResult.stderr || result.compile?.stderr || "").slice(0, 64 * 1024),
      exitCode: runResult.code ?? result.compile?.code ?? null,
      signal: runResult.signal || null,
    });
  } catch (error) {
    log("error", "code_runner.request_failed", { message: error.message });
    return res.status(error.name === "AbortError" ? 504 : 502).json({
      error: error.name === "AbortError"
        ? "Code execution timed out."
        : "Could not reach the code execution service.",
    });
  } finally {
    clearTimeout(timeout);
  }
});

const ipConnections = new Map();
const roomStates = new Map();
let ySocketIO;

async function getRoomState(room) {
  if (!roomStates.has(room)) {
    const statePromise = (async () => {
      const deleted = await ySocketIO.persistence?.provider?.getMeta(room, "deleted");
      if (deleted) return { deleted: true, ownerId: null, members: [] };
      const ownerId = await ySocketIO.persistence?.provider?.getMeta(room, "ownerId");
      const inviteRequired = await ySocketIO.persistence?.provider?.getMeta(room, "inviteRequired");
      const accessVersion = await ySocketIO.persistence?.provider?.getMeta(room, "accessVersion");
      return {
        deleted: false,
        ownerId: ownerId || null,
        inviteRequired: Boolean(inviteRequired),
        accessVersion: Number(accessVersion) || 1,
        members: [],
      };
    })();
    roomStates.set(room, statePromise);
  }
  return roomStates.get(room);
}

function publicRoomState(state, selfId) {
  return {
    selfId,
    ownerId: state.ownerId,
    members: state.members.map(({ socketId, userId, name, color, joinedAt, access }) => ({
      socketId,
      userId,
      name,
      color,
      joinedAt,
      access,
    })),
  };
}

function broadcastRoomState(namespace, state) {
  namespace.emit("room:state", publicRoomState(state));
}

function uniqueMemberName(state, preferredName, socketId) {
  const taken = new Set(
    state.members
      .filter((member) => member.socketId !== socketId)
      .map((member) => member.name.toLocaleLowerCase())
  );
  const baseName = preferredName.trim().slice(0, 24);
  if (!taken.has(baseName.toLocaleLowerCase())) return baseName;

  for (let suffixNumber = 2; suffixNumber < 10000; suffixNumber++) {
    const suffix = ` ${suffixNumber}`;
    const candidate = `${baseName.slice(0, 24 - suffix.length)}${suffix}`;
    if (!taken.has(candidate.toLocaleLowerCase())) return candidate;
  }
  throw new Error("Could not assign a unique display name in this room.");
}

async function removeMember(socket, room, state, socketId = socket.id) {
  const index = state.members.findIndex((member) => member.socketId === socketId);
  if (index === -1) return;
  const [removed] = state.members.splice(index, 1);
  if (state.ownerId === removed.userId && !state.members.some((member) => member.userId === removed.userId)) {
    const nextOwner = [...state.members].sort((a, b) => a.joinedAt - b.joinedAt)[0];
    if (nextOwner) {
      state.ownerId = nextOwner.userId;
      state.accessVersion++;
      nextOwner.access = "edit";
      const nextOwnerSocket = socket.nsp.sockets.get(nextOwner.socketId);
      if (nextOwnerSocket) nextOwnerSocket.data.access = "edit";
      await ySocketIO.persistence?.provider?.setMeta(room, "accessVersion", state.accessVersion);
    }
    await ySocketIO.persistence?.provider?.setMeta(room, "ownerId", state.ownerId);
    if (nextOwner && firestore) {
      try {
        await saveDocumentOwner(room, nextOwner.userId);
      } catch (error) {
        log("error", "documents.owner_transfer_failed", { room, message: error.message });
      }
    }
  }
  broadcastRoomState(socket.nsp, state);
  if (state.members.length === 0 && !state.deleted) roomStates.delete(room);
}

ySocketIO = new YSocketIO(io, {
  levelPersistenceDir: process.env.DATA_DIR || "./data",
  authenticate: async (handshake) => {
    const session = verifyPayload(handshake.auth?.sessionToken);
    return Boolean(session?.sub);
  },
});
ySocketIO.initialize();

const yjsNamespace = ySocketIO.nsp;
yjsNamespace.use(async (socket, next) => {
  const room = socket.nsp.name.replace(/^\/yjs\|/, "");
  if (!validRoom(room)) return next(new Error("Invalid room name."));
  try {
    const identity = verifyPayload(socket.handshake.auth?.sessionToken);
    if (!identity?.sub) return next(new Error("This connection is not authorized."));
    const state = await getRoomState(room);
    if (state.deleted || await ySocketIO.persistence?.provider?.getMeta(room, "deleted")) {
      return next(new Error("This room has been deleted."));
    }
    const invite = verifyPayload(socket.handshake.auth?.inviteToken);
    const inviteIsValid = invite?.kind === "room-invite"
      && invite.room === room
      && invite.ownerId === state.ownerId
      && invite.version === state.accessVersion
      && ["edit", "view"].includes(invite.access);
    if (state.inviteRequired && identity.sub !== state.ownerId && !inviteIsValid) {
      return next(new Error("This room requires a valid invite link."));
    }
    socket.data.userId = identity.sub;
    socket.data.access = identity.sub === state.ownerId
      ? "edit"
      : inviteIsValid ? invite.access : "edit";

    const ip = socket.handshake.address || "unknown";
    const active = ipConnections.get(ip) || 0;
    if (active >= 20) return next(new Error("Too many active room connections."));
    ipConnections.set(ip, active + 1);
    socket.once("disconnect", () => {
      const current = Math.max(0, (ipConnections.get(ip) || 1) - 1);
      if (current === 0) ipConnections.delete(ip);
      else ipConnections.set(ip, current);
    });
    return next();
  } catch (error) {
    log("error", "room.authorization_failed", { message: error.message });
    return next(new Error("Could not authorize this room connection."));
  }
});

yjsNamespace.on("connection", (socket) => {
  const room = socket.nsp.name.replace(/^\/yjs\|/, "");
  const originalOn = socket.on.bind(socket);
  socket.on = (event, listener) => {
    if (event === "sync-update") {
      return originalOn(event, function (update) {
        if (!(update instanceof Uint8Array) || update.byteLength > maxUpdateBytes) {
          log("warn", "room.oversized_update");
          socket.disconnect(true);
          return;
        }
        if (socket.data.access === "view") return;
        listener.call(this, update);
      });
    }
    return originalOn(event, listener);
  };

  socket.once("disconnect", () => {
    const statePromise = roomStates.get(room);
    if (statePromise) {
      statePromise
        .then((state) => removeMember(socket, room, state))
        .catch((error) => log("error", "room.disconnect_cleanup_failed", { message: error.message }));
    }
  });

  socket.on("room:join", async (profile, acknowledge = () => {}) => {
    const identity = verifyPayload(socket.handshake.auth?.sessionToken);
    if (!identity?.sub || !validRoom(room)) {
      acknowledge({ error: "This connection is not authorized." });
      return;
    }
    const state = await getRoomState(room);
    if (state.deleted) {
      acknowledge({ error: "This room has been deleted." });
      socket.disconnect(true);
      return;
    }

    const preferredName = typeof profile?.name === "string" ? profile.name.trim().slice(0, 24) : "";
    const color = /^#[0-9a-f]{6}$/i.test(profile?.color || "") ? profile.color : "#fbbf24";
    if (!preferredName) {
      acknowledge({ error: "A display name is required." });
      return;
    }

    const name = uniqueMemberName(state, preferredName, socket.id);
    const existingMember = state.members.find((member) => member.socketId === socket.id);
    if (existingMember) {
      existingMember.name = name;
      existingMember.color = color;
    } else {
      state.members.push({
        socketId: socket.id,
        userId: identity.sub,
        name,
        color,
        joinedAt: Date.now(),
        access: identity.sub === state.ownerId ? "edit" : socket.data.access,
      });
    }
    if (!state.ownerId) {
      state.ownerId = identity.sub;
      socket.data.access = "edit";
      const member = state.members.find((item) => item.socketId === socket.id);
      if (member) member.access = "edit";
      await ySocketIO.persistence?.provider?.setMeta(room, "ownerId", state.ownerId);
    }
    await ySocketIO.persistence?.provider?.setMeta(room, "created", true);
    let warning;
    if (identity.provider === "firebase" && state.ownerId === identity.sub) {
      try {
        await saveDocumentOwner(room, identity.sub);
      } catch (error) {
        log("error", "documents.owner_save_failed", { room, message: error.message });
        warning = "The room is available, but it could not be added to My Documents.";
      }
    }
    acknowledge({ state: publicRoomState(state, socket.id), assignedName: name, warning });
    broadcastRoomState(socket.nsp, state);
  });

  socket.on("room:update-profile", (profile, acknowledge = () => {}) => {
    const statePromise = roomStates.get(room);
    if (!statePromise) {
      acknowledge({ error: "You are not a member of this room." });
      return;
    }
    statePromise.then((state) => {
      const member = state.members.find((item) => item.socketId === socket.id);
      if (!member) {
        acknowledge({ error: "You are not a member of this room." });
        return;
      }
      if (typeof profile?.name === "string") {
        const preferredName = profile.name.trim().slice(0, 24);
        if (preferredName) member.name = uniqueMemberName(state, preferredName, socket.id);
      }
      if (/^#[0-9a-f]{6}$/i.test(profile?.color || "")) member.color = profile.color;
      acknowledge({ name: member.name, color: member.color });
      broadcastRoomState(socket.nsp, state);
    }).catch((error) => {
      log("error", "room.profile_update_failed", { message: error.message });
      acknowledge({ error: "Could not update your room profile." });
    });
  });

  socket.on("room:leave", async (acknowledge = () => {}) => {
    const state = await getRoomState(room);
    await removeMember(socket, room, state);
    acknowledge({ success: true });
    socket.disconnect(true);
  });

  socket.on("room:kick", async (targetSocketId, acknowledge = () => {}) => {
    const state = await getRoomState(room);
    const actor = state.members.find((member) => member.socketId === socket.id);
    const target = state.members.find((member) => member.socketId === targetSocketId);
    if (!actor || actor.userId !== state.ownerId || !target || target.userId === state.ownerId) {
      acknowledge({ error: "Only the room owner can remove another member." });
      return;
    }

    const targetSocket = socket.nsp.sockets.get(targetSocketId);
    targetSocket?.emit("room:kicked");
    await removeMember(targetSocket || socket, room, state, targetSocketId);
    acknowledge({ success: true });
    targetSocket?.disconnect(true);
  });

  socket.on("room:delete", async (acknowledge = () => {}) => {
    const state = await getRoomState(room);
    const actor = state.members.find((member) => member.socketId === socket.id);
    if (!actor || actor.userId !== state.ownerId) {
      acknowledge({ error: "Only the room owner can delete this room." });
      return;
    }

    if (firestore) {
      try {
        await firestore.collection("documents").doc(room).delete();
      } catch (error) {
        log("error", "documents.delete_failed", { room, message: error.message });
        acknowledge({ error: "Could not remove this room from My Documents. The room was not deleted." });
        return;
      }
    }

    state.deleted = true;
    state.members = [];
    acknowledge({ success: true });
    socket.nsp.emit("room:deleted");
    const document = ySocketIO.documents.get(room);
    if (document) await document.destroy();
    await ySocketIO.persistence?.provider?.clearDocument(room);
    await ySocketIO.persistence?.provider?.setMeta(room, "deleted", true);
    roomStates.delete(room);
  });
});

ySocketIO.on("document-loaded", (document) => {
  let measured = false;
  document.on("update", () => {
    if (measured) return;
    measured = true;
    queueMicrotask(() => {
      measured = false;
      if (Y.encodeStateAsUpdate(document).byteLength > maxDocumentBytes) {
        log("warn", "room.oversized_document", { room: document.name });
        document.namespace.disconnectSockets(true);
      }
    });
  });
});

httpServer.listen(port, () => {
  log("info", "server.started", { port });
});

app.use((error, _req, res, next) => {
  log("error", "http.request_failed", { message: error.message });
  if (res.headersSent) return next(error);
  return res.status(error.status || 500).json({ error: "The request could not be completed." });
});

process.on("SIGTERM", () => {
  io.close(async () => {
    for (const document of ySocketIO.documents.values()) {
      await ySocketIO.persistence?.provider?.flushDocument(document.name);
    }
    await ySocketIO.persistence?.provider?.destroy();
  });
});
