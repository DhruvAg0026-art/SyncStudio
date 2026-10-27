import express from 'express';
import {createServer} from 'http';
import {Server} from 'socket.io';
import {YSocketIO} from "y-socket.io/dist/server";


const app = express();
const httpServer = createServer(app);

const port = Number(process.env.PORT) || 3000;
const clientOrigin = process.env.CLIENT_ORIGIN || "*";

const io = new Server(httpServer, {
  cors: {
    origin: clientOrigin,
  },
});



app.get('/', (req, res) => {
  res.status(200).json({ message: 'Hello World!' ,success: true});
});

app.get('/health', (req, res) => {
  res.status(200).json({ message: 'Server is healthy' ,success: true});
});



// Documents are stored on disk (LevelDB) so they survive server restarts.
// Set DATA_DIR to a persistent volume in production.
const dataDir = process.env.DATA_DIR || "./data";

const ySocketIO = new YSocketIO(io, {
  levelPersistenceDir: dataDir,
});
ySocketIO.initialize();




httpServer.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});