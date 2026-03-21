import jsonServer from "json-server";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";

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

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});