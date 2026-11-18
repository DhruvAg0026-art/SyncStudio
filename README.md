# SyncStudio

**Write documents and code together, in real time.**

SyncStudio is a collaborative workspace where people join a shared *room* and edit the same content at the same time. Every room has two editors that share a single live connection:

- **Doc** - a Google Docs-style rich-text editor (TipTap) with live cursors, comments, images and export.
- **Code** - a Monaco editor (the engine behind VS Code) that can run code and share the output with everyone.

**Live app:** https://sync-studio-sooty.vercel.app/

Built with React, Yjs (CRDTs), Socket.IO, Express and Vite.

---

## Table of contents

- [Features](#features)
- [How it works](#how-it-works)
- [Project structure](#project-structure)
- [Quick start](#quick-start)
- [Configuration](#configuration)
- [Google sign-in and My Documents](#google-sign-in-and-my-documents)
- [Using SyncStudio](#using-syncstudio)
- [Rooms, access and security](#rooms-access-and-security)
- [Code execution](#code-execution)
- [Limits](#limits)
- [Scripts and testing](#scripts-and-testing)
- [Deployment](#deployment)
- [Troubleshooting](#troubleshooting)
- [Tech stack](#tech-stack)

---

## Features

### Document editor

- Rich text: headings, bold, italic, underline, strikethrough, inline code, links, bulleted and numbered lists, quotes, code blocks, dividers and text alignment
- Live, colored cursors with each collaborator's name
- Comment threads anchored to selected text, with replies and resolve / reopen
- Image upload (PNG, JPEG, GIF or WebP, up to 600 KB) that syncs to everyone
- Shared document title, plus live word and character counts
- Export to HTML, Markdown, plain text, or print / save as PDF

### Code editor

- Monaco editor with syntax highlighting for 26 languages
- Shared language selection for the whole room
- Run code in 15 languages through a Piston-compatible sandbox
- Shared output panel with optional standard input, so everyone sees the same result

### Collaboration

- Real-time sync of documents, code, titles, comments and chat with Yjs
- Online members list with per-user colors, owner and view-only badges
- Room chat that syncs through Yjs and keeps the latest 200 messages, with an unread counter
- Version history: save a version manually, or let it auto-save after editing activity; restore any version for everyone
- Members drawer on small screens, so the list and owner controls work on mobile

### Rooms and access

- Create a room with your own name or a generated unique name; join by name, invite link or recent rooms
- Private rooms protected by a password
- Signed invite links that grant **edit** or **view-only** access and expire after 30 days
- The owner can remove members or delete a room; if the owner leaves, ownership moves to the earliest-joined member
- Unique display names inside a room (duplicates get a number, for example `Alex 2`)
- Documents are saved on the server and survive restarts

### Accounts and personalization

- Guests can join with just a display name
- Optional Google sign-in (Firebase) with an owner-only **My Documents** list
- Editable profile (name and cursor color), saved per browser
- Dark and light theme, remembered per user
- Recent rooms list on the start screen

---

## How it works

All collaborative state for a room lives in **one Yjs document** that is synced over a single Socket.IO connection. Switching between Doc and Code does not reconnect.

| Yjs type | Name | Used for |
| --- | --- | --- |
| `XmlFragment` | `doc` | Rich-text document content |
| `Text` | `monaco` | Code editor content |
| `Text` | `title` | Document title |
| `Map` | `docComments` | Comment threads and replies |
| `Array` | `chat` | Chat messages (latest 200) |
| `Array` | `versions` | Saved version snapshots |
| `Map` | `settings` | Shared settings such as the code language |
| `Map` | `run` | Latest shared code run result |

The backend (Express + Socket.IO + `y-socket.io`) authenticates every connection with a signed session token, tracks room members and ownership, enforces view-only access, and persists each room's document to LevelDB. Code is never executed on the SyncStudio server; it is forwarded to an external Piston API.

---

## Project structure

```text
.
|-- .github/workflows/ci.yml      # lint, build and tests on every push and PR
|-- Backend/
|   |-- server.js                 # Express, Socket.IO, Yjs persistence, auth, rooms, /run
|   |-- tests/server.test.js      # backend tests (isolated server + temp LevelDB)
|   `-- .env.example
`-- Frontend/
    |-- src/app/
    |   |-- App.jsx               # start screen, header, members, routing between modes
    |   |-- useCollab.js          # Yjs + Socket.IO connection, session and room state
    |   |-- DocEditor.jsx         # TipTap editor, comments, export
    |   |-- CodeEditor.jsx        # Monaco editor, language picker, code runner
    |   |-- ChatSidebar.jsx       # room chat
    |   |-- VersionHistory.jsx    # snapshots and restore
    |   `-- firebase.js           # optional Google sign-in
    |-- e2e/                      # Playwright two-browser collaboration test
    `-- .env.example
```

---

## Quick start

**Requirements:** Node.js 20.19+ (or 22.12+) and npm.

```bash
git clone https://github.com/DhruvAg0026-art/SyncStudio.git
cd SyncStudio

# Backend
cd Backend
cp .env.example .env        # then edit ROOM_SECRET (see Configuration)
npm install
npm start                   # http://localhost:3000

# Frontend (in a second terminal)
cd Frontend
cp .env.example .env
npm install
npm run dev                 # usually http://localhost:5173
```

Open the URL Vite prints, enter a display name, create a room, and open the same room in a second browser window to see live collaboration. On Windows PowerShell, use `Copy-Item .env.example .env` instead of `cp`.

---

## Configuration

### Backend (`Backend/.env`)

| Variable | Required | Description |
| --- | --- | --- |
| `PORT` | No | Server port. Default `3000` (Render sets this for you). |
| `CLIENT_ORIGIN` | Production | Exact frontend origin allowed by CORS and Socket.IO. Comma-separate multiple origins. |
| `ROOM_SECRET` | Production | Private random string of **32+ characters** used to sign sessions, invites and room tokens. Keep it the same across restarts. |
| `DATA_DIR` | No | Folder for the LevelDB room storage. Default `./data`. Point to persistent storage in production. |
| `PISTON_API_URL` | No | Piston-compatible execute endpoint for Code mode. |
| `FIREBASE_PROJECT_ID` | For Google sign-in | Firebase project ID. |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | For Google sign-in | Firebase Admin service account JSON, as a single environment variable. |

> If you lose `ROOM_SECRET`, existing sessions become invalid and previous owners cannot recover ownership of their rooms. In production the server refuses to start without `CLIENT_ORIGIN` and `ROOM_SECRET`.

### Frontend (`Frontend/.env`)

| Variable | Required | Description |
| --- | --- | --- |
| `VITE_CONNECT` | Yes | Backend URL, for example `http://localhost:3000`. |
| `VITE_FIREBASE_API_KEY` | For Google sign-in | Firebase web app API key. |
| `VITE_FIREBASE_AUTH_DOMAIN` | For Google sign-in | Firebase auth domain. |
| `VITE_FIREBASE_PROJECT_ID` | For Google sign-in | Firebase project ID. |
| `VITE_FIREBASE_APP_ID` | For Google sign-in | Firebase web app ID. |

Never commit `.env` files or the service account JSON. They are already ignored by `.gitignore`.

---

## Google sign-in and My Documents

Guests can always join rooms. Google sign-in is optional and adds a **My Documents** list of rooms you own.

1. Create a Firebase project and enable **Google** under *Authentication > Sign-in method*.
2. Create a **Cloud Firestore** database.
3. Copy the Firebase web app values into `Frontend/.env` (the `VITE_FIREBASE_*` variables).
4. Create a Firebase Admin service account and put its JSON in the backend's `FIREBASE_SERVICE_ACCOUNT_JSON`. Set `FIREBASE_PROJECT_ID` to the same project.
5. Add your deployed frontend domain to Firebase *Authentication > Settings > Authorized domains*.
6. Set Firestore security rules to **deny all direct client reads and writes**. Only the backend (Admin SDK) accesses the `documents` collection.

Google sign-in and My Documents stay unavailable until both the frontend and backend settings are present. Guest access keeps working either way.

---

## Using SyncStudio

- **Create or join:** pick a display name, then create a room (named or generated) or join one by name.
- **Share:** open a room with `?room=my-room&mode=doc` (or `mode=code`). Owners use **Share** to copy an *edit* or *view-only* link; other members can copy an invite link.
- **Switch mode:** use the **Doc / Code** tabs. Both use the same connection and room.
- **Comment:** select text in Doc mode and choose **+ Comment on selection**.
- **Versions:** open **History** to save, preview and restore versions.
- **Leave or delete:** anyone can leave a room; owners can also remove members or delete the room.

Dialogs such as leave, delete, remove member and restore version use in-app confirmations instead of browser pop-ups.

---

## Rooms, access and security

- The first member to join a room becomes its owner. If the owner leaves, the earliest-joined remaining member becomes owner.
- Room names are 1-40 characters of letters, numbers, dashes or underscores, and are reserved on the server. Creating a name that is already used is rejected; use **Join room** instead.
- Private rooms require a password (6-128 characters). Passwords are hashed with bcrypt and exchanged for a short-lived (1 hour) access token.
- Once an owner creates an invite link, new joins require a valid invite. Invites are signed, last 30 days, and are invalidated when ownership changes.
- View-only members are enforced by the backend, which drops their edits, not just by the UI.
- Guest and Google sessions use signed tokens valid for 30 days.
- Requests are rate limited (sessions, room creation, invites, private room access and code runs), and each IP is limited to 20 active room connections.

---

## Code execution

Code mode sends code and standard input from the **backend** to an external [Piston](https://github.com/engineer-man/piston) API. SyncStudio does not run submitted code on its own server.

- Runnable languages: JavaScript, TypeScript, Python, Java, C, C++, C#, Go, Rust, PHP, Ruby, Swift, Kotlin, Dart and Lua. Other languages (HTML, CSS, JSON, SQL and so on) have syntax highlighting only.
- The endpoint caps code and input at 20 KB, applies compile and run time limits, limits memory to 128 MB, and allows 10 runs per minute per IP.
- Source code and input are sent to whichever service `PISTON_API_URL` points to.
- The public Piston endpoint returned HTTP 401 during verification. For production, point `PISTON_API_URL` at an accessible, Piston-compatible service (for example your own).

---

## Limits

| Item | Limit |
| --- | --- |
| Display name | 24 characters |
| Room name | 1-40 characters (`a-z`, `0-9`, `-`, `_`) |
| Image upload | 600 KB (PNG, JPEG, GIF, WebP) |
| Chat history | Latest 200 messages, 2,000 characters each |
| Saved versions | 30 per room, 100 KB per snapshot (oldest removed first) |
| Document size | 10 MB per room; a single sync update up to 1 MB |
| Code and stdin | 20 KB each |
| Invite link lifetime | 30 days |

Version snapshots store the active mode's state, so large documents (for example with big images) may exceed the 100 KB snapshot limit and cannot be saved as a version.

---

## Scripts and testing

### Frontend (`Frontend/`)

```bash
npm run dev       # start the Vite dev server
npm run build     # production build
npm run preview   # preview the production build
npm run lint      # ESLint
npm test          # Vitest + Testing Library unit tests
npm run test:e2e  # Playwright two-browser collaboration test
```

Install the browser for end-to-end tests once with `npx playwright install chromium`.

### Backend (`Backend/`)

```bash
npm start         # start the server
npm run dev       # start with nodemon
npm run build     # syntax check
npm test          # backend tests (isolated server, temporary LevelDB)
```

The backend exposes a health check at `GET /health`.

GitHub Actions runs lint, build and tests for both apps (plus the Playwright test) on every push and pull request.

---

## Deployment

The app is deployed as a **Vercel** frontend plus a **Render** backend. The backend must be a long-running Web Service (not a static site) because Socket.IO and Yjs need persistent connections.

### Backend on Render

Create a **Web Service** from this repository:

```text
Root Directory: Backend
Build Command:  npm install
Start Command:  npm start
```

Environment variables:

```text
CLIENT_ORIGIN=https://your-app.vercel.app
ROOM_SECRET=use-a-private-random-secret-at-least-32-characters-long
DATA_DIR=/var/data
```

Render provides `PORT` automatically. Add Firebase and `PISTON_API_URL` variables if you use Google sign-in or Code execution.

**Persistence:** on hosts with an ephemeral disk (such as Render's free tier), the data folder is wiped on every redeploy or restart. Attach a persistent disk and point `DATA_DIR` at it (for example `/var/data`) if documents must last.

### Frontend on Vercel

Import the same repository:

```text
Root Directory:   Frontend
Build Command:    npm run build
Output Directory: dist
```

Environment variable:

```text
VITE_CONNECT=https://your-backend.onrender.com
```

Deploy the frontend first to get its URL, set `CLIENT_ORIGIN` on the backend to that exact origin, then redeploy the backend.

---

## Troubleshooting

| Problem | What to check |
| --- | --- |
| Stuck on "Connecting" or "Offline" | `VITE_CONNECT` points to the backend, the backend is running, and `CLIENT_ORIGIN` exactly matches the frontend origin (including `https://` and no trailing slash). |
| "This room requires a valid invite link" | The owner turned on invites. Ask for a fresh edit or view-only link. |
| Run button fails with an execution service error | `PISTON_API_URL` must point to an accessible Piston-compatible endpoint. |
| Documents disappear after a redeploy | The host disk is ephemeral. Attach persistent storage and set `DATA_DIR`. |
| Google sign-in is unavailable | Both the `VITE_FIREBASE_*` frontend variables and the backend service account must be set, and your domain must be an authorized Firebase domain. |
| Everyone is signed out after a restart | `ROOM_SECRET` changed. Keep the same value across restarts. |
| "Save version" says the snapshot is too large | The document exceeds 100 KB of state, often because of large images. |

---

## Tech stack

- **Frontend:** React 19, Vite, Tailwind CSS, TipTap, Monaco Editor, Yjs, `y-socket.io`, Firebase Auth
- **Backend:** Node.js, Express 5, Socket.IO, Yjs, `y-socket.io`, LevelDB persistence, bcrypt, Helmet, express-rate-limit, Firebase Admin
- **Testing and CI:** Vitest, Testing Library, Playwright, Node's built-in test runner, GitHub Actions
- **Hosting:** Vercel (frontend), Render (backend)
