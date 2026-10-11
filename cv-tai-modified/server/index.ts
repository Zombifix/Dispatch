import express, { type Request, Response, NextFunction } from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import passport from "passport";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { setupPassport } from "./auth";
import { pool } from "./db";
import { runMigrations } from "./migrate";

const app = express();
const httpServer = createServer(app);

if (process.env.NODE_ENV === "production") {
  // Railway sits behind a proxy; trust it so secure session cookies are accepted.
  app.set("trust proxy", 1);
}

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  express.json({
    limit: "15mb",
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

// Guard: SESSION_SECRET must be set in production
if (process.env.NODE_ENV === "production" && !process.env.SESSION_SECRET) {
  console.error("[FATAL] SESSION_SECRET is not set. Refusing to start in production with a default secret.");
  process.exit(1);
}

const PgStore = connectPgSimple(session);
app.use(session({
  store: new PgStore({ pool, tableName: "session", createTableIfMissing: false }),
  secret: process.env.SESSION_SECRET || "cv-tailor-dev-secret-change-in-prod",
  proxy: process.env.NODE_ENV === "production",
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    httpOnly: true,
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
  },
}));

app.use(passport.initialize());
app.use(passport.session());
setupPassport();

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

// Journal d'accès minimal : jamais le corps des réponses (CV, emails, offres).
app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  res.on("finish", () => {
    if (path.startsWith("/api")) {
      log(`${req.method} ${path} ${res.statusCode} in ${Date.now() - start}ms`);
    }
  });
  next();
});

// Sonde de santé pour l'hébergeur (Coolify/Docker). Vérifie aussi la base.
app.get("/healthz", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true });
  } catch {
    res.status(503).json({ ok: false });
  }
});

(async () => {
  await runMigrations(pool);

  await registerRoutes(httpServer, app);

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    // Les détails internes restent dans les logs, jamais dans la réponse.
    const message = status < 500 ? (err.message || "Requete invalide") : "Erreur serveur.";

    console.error("Internal Server Error:", err);

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message });
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
    },
    () => {
      log(`serving on port ${port}`);
    },
  );
})();
