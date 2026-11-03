# SyncStudio

SyncStudio is a real-time collaborative workspace built with React, Yjs, and Socket.IO. Multiple users can join the same room, see who is online, and edit together in two modes:

- **Doc** - a Google Docs-style rich-text editor (TipTap) with live cursors
- **Code** - a Monaco-based JavaScript editor

Live app: https://sync-studio-sooty.vercel.app/

## Features

- Real-time collaborative editing (Doc and Code modes share one connection per room)
- Rich-text toolbar: headings, bold/italic/underline/strike, links, lists, quotes, code blocks, alignment, undo/redo
- Live colored cursors with user names
- Rooms via URL (`?room=my-room&mode=doc`) and a "Copy invite link" button
- Per-user dark/light theme, editable profile, recent rooms, and unique room-name generation
- Optional Google sign-in with an owner-only My Documents dashboard
- Room display names are unique; duplicate usernames receive an automatic numeric suffix
- Room members can leave; owners can remove members or delete a room
- Ownership transfers to the earliest-joined remaining member when the owner leaves
- Code mode can run selected languages in the external Piston sandbox, with shared output
- Room chat syncs through Yjs and keeps the latest 200 messages
- Version history can be manually saved or automatically captured after editing activity
- Synced document title, word/character count
- Export to HTML, Markdown, plain text, or print / save as PDF
- Documents are saved on the server and survive restarts
- Monaco Editor with JavaScript syntax highlighting
- Live online users list with per-user colors
- Socket.IO and Yjs synchronization
- Vite-powered React frontend

## Project Structure

```text
.
|-- Backend/
|   |-- server.js
|   `-- package.json
|-- Frontend/
|   |-- src/app/App.jsx
|   |-- .env.example
|   `-- package.json
`-- .gitignore
```

## Requirements

- Node.js 20.19 or newer (or 22.12+)
- npm

## Setup

Install dependencies in both applications:

```bash
cd Backend
npm install

cd ../Frontend
npm install
```

Create `Frontend/.env` from the example file:

```env
VITE_CONNECT="http://localhost:3000"
```

Create `Backend/.env` from `Backend/.env.example`. Set `ROOM_SECRET` to a
private random value of at least 32 characters and keep the same value across
backend restarts. The backend signs anonymous session tokens with this secret;
losing it invalidates existing sessions and prevents the previous owner from
recovering ownership of a room. `CLIENT_ORIGIN` must exactly match the frontend
origin in production. `DATA_DIR` should point to persistent storage if room
documents need to survive redeployments.

### Google sign-in and My Documents

Create a Firebase project, enable Google in **Authentication → Sign-in method**,
and create a Cloud Firestore database. Copy the Firebase web app values into
`Frontend/.env` using `Frontend/.env.example`. Add a Firebase Admin service
account JSON to the backend's `FIREBASE_SERVICE_ACCOUNT_JSON` environment
variable, and set `FIREBASE_PROJECT_ID` to the same project ID. Keep the service
account private; do not commit it. Add the deployed frontend domain to Firebase
Authentication's authorized domains.

My Documents stores room ownership records in the Firestore `documents`
collection. The backend uses the Admin SDK, so client-side Firestore access is
not required; configure Firestore security rules to deny direct client reads and
writes. Google sign-in and My Documents remain unavailable until both frontend
web settings and backend service-account settings are configured. Guest room
joining remains available.

## Run Locally

Start the backend in one terminal:

```bash
cd Backend
npm start
```

Start the frontend in another terminal:

```bash
cd Frontend
npm run dev
```

Open the URL shown by Vite, usually `http://localhost:5173`.

## Checks

Run `npm run lint` and `npm run build` in `Frontend/`. Run `npm run build` and
`npm test` in `Backend/`; the backend tests start an isolated local server and
use a temporary LevelDB directory. GitHub Actions runs these checks on pushes
and pull requests.

## Rooms and code execution

The first active member to join a room becomes its owner. The owner can kick
members or delete the room; when the owner leaves, ownership is transferred to
the earliest-joined active member. Room ownership and deletion markers are
stored as LevelDB metadata alongside Yjs persistence. Room names and ownership
are enforced by the backend, not only by frontend controls.

From the start screen, you can create a room with a chosen name or have SyncStudio
generate a unique name. Creating with a chosen name that's already in use is
rejected; use **Join room** to join by name or invite link. Room names are reserved
in LevelDB metadata. Duplicate display names within a room are automatically
numbered (for example, `Alex 2`).

Code execution is sent from the backend to the external Piston API (configurable
with `PISTON_API_URL`); SyncStudio does not execute submitted code on its own
server. The endpoint allows a bounded set of runtimes, caps code/stdin size,
limits requests per IP, and applies execution time/memory limits. Submitted
source code and stdin are sent to the configured execution service. The public
Piston endpoint returned HTTP 401 during verification, so production deployments
must point `PISTON_API_URL` at an accessible Piston-compatible service.

Version snapshots include the active mode's Yjs state and are shared with the
room. They are capped at 30 versions and 100 KB per snapshot to bound document
growth; larger documents cannot currently be snapshotted. Each version stores a
base64 state update plus a restore payload, so storage grows with document size
and snapshot count. Oldest snapshots are removed first.

## Saving documents

The backend stores every room's document in a local LevelDB folder (`Backend/data` by default, ignored by git). Set `DATA_DIR` to change the location.

On hosts with an ephemeral disk (for example Render's free tier), that folder is wiped on every redeploy/restart. Attach a persistent disk and point `DATA_DIR` at it (for example `/var/data`) if you need documents to last.

## Deployment

### Backend on Render

Create a **Web Service** from this repository. Use these settings:

```text
Root Directory: Backend
Build Command: npm install
Start Command: npm start
```

Add this environment variable after the Vercel frontend is created:

```text
CLIENT_ORIGIN=https://your-app.vercel.app
ROOM_SECRET=use-a-private-random-secret-at-least-32-characters-long
DATA_DIR=/var/data
```

Render provides `PORT` automatically. Use a Web Service, not a static site, because Socket.IO and Yjs need a long-running server. Configure `CLIENT_ORIGIN` with the deployed frontend's exact origin and set a persistent `ROOM_SECRET`.

### Frontend on Vercel

Import the same repository and set:

```text
Root Directory: Frontend
Build Command: npm run build
Output Directory: dist
```

Add this Vercel environment variable:

```text
VITE_CONNECT=https://your-backend.onrender.com
```

Replace both placeholder URLs with the real Render and Vercel URLs, then redeploy the backend after setting `CLIENT_ORIGIN`.

## Available Scripts

### Frontend

```bash
npm run dev      # Start the Vite development server
npm run build    # Create a production build
npm run lint     # Run ESLint
npm run preview  # Preview the production build
```

### Backend

```bash
npm start        # Start the Socket.IO server
npm run dev      # Start with nodemon
```

The backend exposes a health endpoint at `http://localhost:3000/health`.

## Technology

- React
- Vite
- Monaco Editor
- Yjs
- y-monaco
- y-socket.io
- Express
- Socket.IO
