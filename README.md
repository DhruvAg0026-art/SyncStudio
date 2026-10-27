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

- Node.js 18 or newer
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
```

Render provides `PORT` automatically. Use a Web Service, not a static site, because Socket.IO and Yjs need a long-running server.

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
