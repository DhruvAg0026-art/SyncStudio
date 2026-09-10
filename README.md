# SyncStudio

SyncStudio is a real-time collaborative code editor built with React, Monaco Editor, Yjs, and Socket.IO. Multiple users can join the same room, see who is online, and edit JavaScript code together.

## Features

- Real-time collaborative editing
- Monaco Editor with JavaScript syntax highlighting
- Live online users list
- Username-based room presence
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
