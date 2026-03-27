import jsonServer from "json-server";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { Server } from "socket.io";
import { createServer } from "node:http";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const server = jsonServer.create();
const router = jsonServer.router(path.join(__dirname, "db.json"));
const middlewares = jsonServer.defaults();

server.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

server.use(middlewares);
server.use(jsonServer.bodyParser);

server.options("*", (req, res) => {
  res.sendStatus(204);
});

server.post("/auth/login", (req, res) => {
    const { email, password } = req.body;
    const db = router.db;
    const users = db.get("users").value();

    const user = users.find(u => u.email === email && u.password === password);

    if (user) {
        const accessToken = "jwt-token-" + Date.now();
        const refreshToken = "refresh-token-" + Date.now();

        res.json({
            accessToken,
            refreshToken,
            user: {
                id: user.id.toString(),
                email: user.email,
                name: user.name || "User"
            }
        });
    } else {
        res.status(401).json({ message: "Invalid credentials" });
    }
});

server.post("/auth/register", (req, res) => {
    const { email, password, name } = req.body;
    const db = router.db;
    const users = db.get("users").value();

    const existingUser = users.find(u => u.email === email);
    if (existingUser) {
        return res.status(400).json({ message: "User already exists" });
    }

    const newUser = {
        id: users.length + 1,
        email,
        password,
        name: name || "User"
    };

    db.get("users").push(newUser).write();

    const accessToken = "jwt-token-" + Date.now();
    const refreshToken = "refresh-token-" + Date.now();

    res.status(201).json({
        accessToken,
        refreshToken,
        user: {
            id: newUser.id.toString(),
            email: newUser.email,
            name: newUser.name
        }
    });
});

server.post("/auth/refresh", (req, res) => {
    const { refreshToken } = req.body;

    const accessToken = "jwt-token-" + Date.now();
    const newRefreshToken = "refresh-token-" + Date.now();

    res.json({
        accessToken,
        refreshToken: newRefreshToken,
        user: {
            id: "1",
            email: "user@example.com",
            name: "User"
        }
    });
});


server.use("/api", router);

const httpServer = createServer(server);
const io = new Server(httpServer, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"],
        allowedHeaders: ["Content-Type", "Authorization"],
        credentials: true
    }
});

const messagesByEvent = new Map()

const loadMessagesFromDb = () => {
    const db = router.db;
    const messages = db.get("messages").value() || [];
    messages.forEach(msg => {
        const eventKey = String(msg.eventId);
        if(!messagesByEvent.has(eventKey)) {
            messagesByEvent.set(eventKey, []);
        }
        messagesByEvent.get(eventKey).push({...msg, eventId: eventKey});
    });
};

loadMessagesFromDb();

io.on('connection', (socket) => {
    console.log(`Nouvelle connexion Socket.IO - ID: ${socket.id}`);

    let currentEventId = null;
    let currentUserId = null;

    socket.on('join', (payload) => {
        const { eventId, userId, userName } = payload;

        const eventKey = String(eventId)

        currentEventId = eventKey;
        currentUserId = userId;

        socket.join(eventKey);

        const history = messagesByEvent.get(eventKey) || [];

        socket.emit('history', history);

        console.log(`User ${userId} (${userName}) joined event ${eventKey}`);
    });

    socket.on('message', (payload) => {
        const { eventId, content, userId, userName, userAvatar } = payload;

        const eventKey = String(eventId);

        const newMessage = {
            id: Date.now().toString(),
            eventId: eventKey,
            userId,
            userName,
            userAvatar,
            content,
            timestamp: new Date().toISOString()
        };

        if (!messagesByEvent.has(eventKey)) {
            messagesByEvent.set(eventKey, []);
        }
        messagesByEvent.get(eventKey).push(newMessage);

        if (messagesByEvent.get(eventKey).length > 100) {
            messagesByEvent.get(eventKey).shift();
        }

        const db = router.db;
        db.get("messages").push(newMessage).write();

        io.to(eventKey).emit('message', newMessage);
    });

    socket.on('disconnect', () => {
        console.log(`Client déconnecté (socket ${socket.id}) - event: ${currentEventId}`);
    });
});

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
  console.log(`WebSocket server running on ws:localhost:${PORT}`)
  console.log(`Server running on port ${PORT}`);
  console.log(`WebSocket ready for a chat`)
});