import jsonServer from "json-server";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { Server } from "socket.io";
import { createServer } from "node:http";
import nodemailer from "nodemailer";
import dotenv from "dotenv";

dotenv.config();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const server = jsonServer.create();
const router = jsonServer.router(path.join(__dirname, "db.json"));
const db = router.db;
const middlewares = jsonServer.defaults();

const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
    },
});

const sendEmail = async ({ to, subject, text, html }) => {
    if (!to) return;
    try {
        await transporter.sendMail({
            from: `"Event Platform" <${process.env.EMAIL_USER}>`,
            to,
            subject,
            text: text ?? "",
            html: html ?? text ?? "",
        });
        console.log("Email envoyé à", to);
    } catch (err) {
        console.error("Erreur email:", err);
    }
};

function getAdminEmailForEvent(event) {
    if (process.env.ADMIN_EMAIL) return process.env.ADMIN_EMAIL;
    let organizers = [];
    try {
        const v = db.get("organizers").value();
        organizers = Array.isArray(v) ? v : [];
    } catch {
        organizers = [];
    }
    const org = organizers.find((o) => String(o.id) === String(event.organizerId));
    return org?.email ?? null;
}

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
    const users = db.get("users").value();

    const user = users.find((u) => u.email === email && u.password === password);

    if (user) {
        const accessToken = "jwt-token-" + Date.now();
        const refreshToken = "refresh-token-" + Date.now();

        res.json({
            accessToken,
            refreshToken,
            user: {
                id: user.id.toString(),
                email: user.email,
                name: user.name || "User",
            },
        });
    } else {
        res.status(401).json({ message: "Invalid credentials" });
    }
});

server.post("/auth/register", (req, res) => {
    try {
        const { email, password, name } = req.body;
        if (!email || !password) {
            return res.status(400).json({ message: "Email et mot de passe requis" });
        }
        const users = db.get("users").value();
        if (users.some((u) => u.email === email)) {
            return res.status(400).json({ message: "User already exists" });
        }
        const id = Math.max(0, ...users.map((u) => Number(u.id) || 0)) + 1;
        const newUser = { id, email, password, name: name || "" };
        db.get("users").push(newUser).write();
        res.status(201).json({
            id: String(id),
            email: newUser.email,
            name: newUser.name,
        });
    } catch (e) {
        console.error("Signup error:", e);
        res.status(500).json({ error: "Internal server error" });
    }
});

server.post("/api/registrations", async (req, res) => {
    try {
        const { eventId, userName, userEmail, userPhone, numberOfTickets, userId } =
            req.body;

        const event = db.get("events").find({ id: eventId }).value();

        if (!event) {
            return res.status(404).json({ error: "Event not found" });
        }

        const isPaidEvent = event.price > 0;
        const ticketsCount = numberOfTickets || 1;
        const totalPrice = event.price * ticketsCount;

        const registration = {
            id: `reg_${Date.now()}`,
            eventId,
            userId,
            userName,
            userEmail,
            userPhone,
            numberOfTickets: ticketsCount,
            status: isPaidEvent ? "pending" : "confirmed",
            paymentStatus: isPaidEvent ? "pending" : "free",
            paymentLink: isPaidEvent
                ? `${process.env.FRONTEND_URL}/payment/${Date.now()}`
                : null,
            createdAt: new Date().toISOString(),
        };

        db.get("registrations").push(registration).write();

        const participant = {
            id: `part_${Date.now()}`,
            userId,
            userName,
            userEmail,
            userPhone,
            numberOfTickets: ticketsCount,
            registrationDate: new Date().toISOString(),
            status: isPaidEvent ? "pending" : "confirmed",
            paymentStatus: isPaidEvent ? "pending" : "free",
        };

        const eventParticipants = event.participants || [];
        eventParticipants.push(participant);

        db.get("events")
            .find({ id: eventId })
            .assign({
                participants: eventParticipants,
                availableSeats: event.availableSeats - ticketsCount,
            })
            .write();

        const adminEmail = getAdminEmailForEvent(event);
        if (adminEmail) {
            const adminHtml = `
        <div style="font-family: Arial, sans-serif; max-width: 600px;">
          <h2 style="color: #f5c518;">Nouvelle inscription</h2>
          <p><strong>${userName}</strong> vient de s'inscrire à <strong>${event.title}</strong>.</p>
          <ul>
            <li>Email : ${userEmail}</li>
            <li>Téléphone : ${userPhone}</li>
            <li>Places : ${ticketsCount}</li>
            <li>Statut paiement : ${isPaidEvent ? "En attente" : "Gratuit"}</li>
          </ul>
          ${
                isPaidEvent && registration.paymentLink
                    ? `<p><a href="${registration.paymentLink}">Lien de paiement participant</a></p>`
                    : ""
            }
        </div>`;
            await sendEmail({
                to: adminEmail,
                subject: `[Admin] Nouvelle inscription — ${event.title}`,
                text: `Inscription: ${userName} (${userEmail}) — ${event.title}. Places: ${ticketsCount}.`,
                html: adminHtml,
            });
        }

        if (isPaidEvent) {
            const emailHtml = `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                    <h2 style="color: #f5c518;">✅ Inscription confirmée - ${event.title}</h2>
                    <p>Bonjour ${userName},</p>
                    <p>Votre inscription a bien été enregistrée avec succès !</p>
                    
                    <div style="background-color: #1f1f1f; padding: 20px; border-radius: 10px; margin: 20px 0; border: 1px solid #333;">
                        <h3 style="color: #f5c518; margin-bottom: 15px;">Détails de l'événement :</h3>
                        <p><strong>📅 Date :</strong> ${new Date(event.date).toLocaleDateString("fr-FR")}</p>
                        <p><strong>📍 Lieu :</strong> ${event.address || event.cityId}</p>
                        <p><strong>🎫 Nombre de places :</strong> ${ticketsCount}</p>
                        <p><strong>💰 Total à payer :</strong> ${totalPrice} €</p>
                    </div>
                    
                    <div style="background-color: #f5c51820; padding: 15px; border-radius: 10px; margin: 20px 0; border-left: 4px solid #f5c518;">
                        <p><strong>📌 Action requise :</strong> Utilisez le lien ci-dessous pour payer.</p>
                    </div>
                    
                    <p>À très bientôt !</p>
                    <p style="color: #666;">L'équipe organisatrice</p>
                </div>
            `;

            await sendEmail({
                to: userEmail,
                subject: `✅ Inscription confirmée - ${event.title}`,
                text: `Votre inscription pour ${event.title} a été enregistrée. Total à payer: ${totalPrice} €`,
                html: emailHtml,
            });

            const paymentHtml = `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                    <h2 style="color: #f5c518;">💳 Paiement requis - ${event.title}</h2>
                    <p>Bonjour ${userName},</p>
                    <p>Pour finaliser votre inscription, veuillez procéder au paiement :</p>
                    
                    <div style="background-color: #1f1f1f; padding: 20px; border-radius: 10px; margin: 20px 0; text-align: center;">
                        <p style="font-size: 24px; color: #f5c518; margin-bottom: 20px;"><strong>${totalPrice} €</strong></p>
                        <a href="${registration.paymentLink}" 
                           style="display: inline-block; background-color: #f5c518; color: black; padding: 12px 30px; text-decoration: none; border-radius: 8px; font-weight: bold;">
                            💳 Payer maintenant
                        </a>
                        <p style="margin-top: 15px; font-size: 12px; color: #666;">Ce lien est valable 24h</p>
                    </div>
                    
                    <p>Une fois le paiement effectué, vous recevrez vos billets par email.</p>
                    <p>L'équipe organisatrice</p>
                </div>
            `;

            await sendEmail({
                to: userEmail,
                subject: `💳 Paiement requis - ${event.title}`,
                text: `Paiement requis pour ${event.title}. Montant: ${totalPrice} €. Lien: ${registration.paymentLink}`,
                html: paymentHtml,
            });
        } else {
            const emailHtml = `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                    <h2 style="color: #f5c518;">✅ Inscription confirmée !</h2>
                    <p>Bonjour ${userName},</p>
                    <p>Votre inscription pour l'événement <strong>${event.title}</strong> a bien été enregistrée avec succès.</p>
                    
                    <div style="background-color: #1f1f1f; padding: 20px; border-radius: 10px; margin: 20px 0;">
                        <h3 style="color: #f5c518;">Détails de l'événement :</h3>
                        <p><strong>📅 Date :</strong> ${new Date(event.date).toLocaleDateString("fr-FR")}</p>
                        <p><strong>📍 Lieu :</strong> ${event.address || event.cityId}</p>
                        <p><strong>🎫 Nombre de places :</strong> ${ticketsCount}</p>
                        <p><strong>🎟️ Prix :</strong> Gratuit</p>
                    </div>
                    
                    <div style="background-color: #10b98120; padding: 15px; border-radius: 10px; margin: 20px 0;">
                        <p>✅ Présentez cet email à l'entrée de l'événement.</p>
                    </div>
                    
                    <p>À très bientôt !</p>
                    <p style="color: #666;">L'équipe organisatrice</p>
                </div>
            `;

            await sendEmail({
                to: userEmail,
                subject: `✅ Inscription confirmée - ${event.title}`,
                text: `Votre inscription pour ${event.title} a été confirmée.`,
                html: emailHtml,
            });
        }

        res.status(201).json({
            ...registration,
            paymentRequired: isPaidEvent,
        });
    } catch (error) {
        console.error("Registration error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
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
            name: "User",
        },
    });
});

server.use("/api", router);

const httpServer = createServer(server);
const io = new Server(httpServer, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"],
        allowedHeaders: ["Content-Type", "Authorization"],
        credentials: true,
    },
});

const messagesByEvent = new Map();

const loadMessagesFromDb = () => {
    const messages = db.get("messages").value() || [];
    messages.forEach((msg) => {
        const eventKey = String(msg.eventId);
        if (!messagesByEvent.has(eventKey)) {
            messagesByEvent.set(eventKey, []);
        }
        messagesByEvent.get(eventKey).push({ ...msg, eventId: eventKey });
    });
};

loadMessagesFromDb();

io.on("connection", (socket) => {
    console.log(`Nouvelle connexion Socket.IO - ID: ${socket.id}`);

    let currentEventId = null;
    let currentUserId = null;

    socket.on("join", (payload) => {
        const { eventId, userId, userName } = payload;

        const eventKey = String(eventId);

        currentEventId = eventKey;
        currentUserId = userId;

        socket.join(eventKey);

        const history = messagesByEvent.get(eventKey) || [];

        socket.emit("history", history);

        console.log(`User ${userId} (${userName}) joined event ${eventKey}`);
    });

    socket.on("message", (payload) => {
        const { eventId, content, userId, userName, userAvatar } = payload;

        const eventKey = String(eventId);

        const newMessage = {
            id: Date.now().toString(),
            eventId: eventKey,
            userId,
            userName,
            userAvatar,
            content,
            seenBy: [],
            timestamp: new Date().toISOString(),
        };

        if (!messagesByEvent.has(eventKey)) {
            messagesByEvent.set(eventKey, []);
        }
        messagesByEvent.get(eventKey).push(newMessage);

        if (messagesByEvent.get(eventKey).length > 100) {
            messagesByEvent.get(eventKey).shift();
        }

        db.get("messages").push(newMessage).write();

        io.to(eventKey).emit("message", newMessage);
    });

    socket.on("seen", ({ eventId, messageIds, userId }) => {
        const eventKey = String(eventId);

        const messages = messagesByEvent.get(eventKey) || [];

        messages.forEach((msg) => {
            if (messageIds.includes(msg.id)) {
                msg.seenBy = msg.seenBy || [];

                if (!msg.seenBy.includes(userId)) {
                    msg.seenBy.push(userId);
                }

                db.get("messages")
                    .find({ id: msg.id })
                    .assign({ seenBy: msg.seenBy })
                    .write();
            }
        });

        io.to(eventKey).emit("seen", { messageIds, userId });
    });

    socket.on("admin_reply", async (payload) => {
        const { eventId, content, userId, userName, userEmail, type, paymentLink } =
            payload;
        const eventKey = String(eventId);

        const event = db.get("events").find({ id: eventKey }).value();

        const newMessage = {
            id: Date.now().toString(),
            eventId: eventKey,
            userId: "admin",
            userName: "Admin",
            content,
            type: type || "chat",
            seenBy: [],
            timestamp: new Date().toISOString(),
        };

        if (!messagesByEvent.has(eventKey)) {
            messagesByEvent.set(eventKey, []);
        }
        messagesByEvent.get(eventKey).push(newMessage);
        db.get("messages").push(newMessage).write();
        io.to(eventKey).emit("message", newMessage);

        let emailSubject = "";
        let emailHtml = "";
        let emailText = "";

        if (type === "payment") {
            emailSubject = `💳 Paiement requis - ${event?.title || "Événement"}`;
            emailHtml = `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <h2 style="color: #f5c518;">💳 Paiement requis</h2>
                <p>Bonjour ${userName},</p>
                <p>Pour finaliser votre inscription, veuillez effectuer le paiement :</p>
                
                <div style="background-color: #1f1f1f; padding: 20px; border-radius: 10px; margin: 20px 0; text-align: center;">
                    <a href="${paymentLink}" style="display: inline-block; background-color: #f5c518; color: black; padding: 12px 30px; text-decoration: none; border-radius: 8px; font-weight: bold;">
                        💳 Payer maintenant
                    </a>
                </div>
                
                <div style="background-color: #333; padding: 15px; border-radius: 10px; margin: 20px 0;">
                    <p style="color: #f5c518; margin-bottom: 10px;"><strong>Message de l'administrateur :</strong></p>
                    <p>${content}</p>
                </div>
                
                <p>À très bientôt !</p>
                <p style="color: #666;">L'équipe organisatrice</p>
            </div>
        `;
            emailText = `Paiement requis: ${paymentLink}\n\nMessage: ${content}`;
        } else if (type === "info") {
            emailSubject = `ℹ️ Information importante - ${event?.title || "Événement"}`;
            emailHtml = `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <h2 style="color: #f5c518;">ℹ️ Information importante</h2>
                <p>Bonjour ${userName},</p>
                
                <div style="background-color: #333; padding: 20px; border-radius: 10px; margin: 20px 0;">
                    <p style="color: #f5c518; margin-bottom: 10px;"><strong>Message de l'administrateur :</strong></p>
                    <p>${content}</p>
                </div>
                
                <a href="${process.env.FRONTEND_URL}/api/events/${eventKey}" 
                   style="display: inline-block; background-color: #f5c518; color: black; padding: 10px 20px; text-decoration: none; border-radius: 8px;">
                    Voir l'événement
                </a>
                
                <p style="margin-top: 20px;">Cordialement,</p>
                <p style="color: #666;">L'équipe organisatrice</p>
            </div>
        `;
            emailText = `Message de l'administrateur: ${content}`;
        } else {
            emailSubject = `💬 Réponse de l'administrateur - ${event?.title || "Événement"}`;
            emailHtml = `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <h2 style="color: #f5c518;">💬 Réponse de l'administrateur</h2>
                <p>Bonjour ${userName},</p>
                
                <div style="background-color: #333; padding: 20px; border-radius: 10px; margin: 20px 0;">
                    <p style="color: #f5c518; margin-bottom: 10px;"><strong>Réponse :</strong></p>
                    <p>${content}</p>
                </div>
                
                <a href="${process.env.FRONTEND_URL}/api/events/${eventKey}" 
                   style="display: inline-block; background-color: #f5c518; color: black; padding: 10px 20px; text-decoration: none; border-radius: 8px;">
                    Voir la conversation
                </a>
                
                <p style="margin-top: 20px;">Cordialement,</p>
                <p style="color: #666;">L'équipe organisatrice</p>
            </div>
        `;
            emailText = `Réponse: ${content}`;
        }

        if (userEmail) {
            await sendEmail({
                to: userEmail,
                subject: emailSubject,
                text: emailText,
                html: emailHtml,
            });
            console.log(`✅ Email envoyé à ${userEmail} (type: ${type})`);
        }
    });

    socket.on("disconnect", () => {
        console.log(`Client déconnecté (socket ${socket.id}) - event: ${currentEventId}`);
    });
});

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
    console.log(`WebSocket server running on ws:localhost:${PORT}`);
    console.log(`Server running on port ${PORT}`);
    console.log(`WebSocket ready for a chat`);
});
