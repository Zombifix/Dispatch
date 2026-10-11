import express, { type NextFunction, type Request, type Response } from "express";
import helmet from "helmet";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import passport from "passport";
import { createServer } from "http";
import { registerRoutes } from "./routes";
import { setupPassport } from "./auth";
import { pool } from "./db";

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true });
  console.log(`${formattedTime} [${source}] ${message}`);
}

/**
 * Construit l'application (sécurité, sessions, routes, erreurs) sans écouter de port.
 * Utilisé par server/index.ts et par les tests d'API.
 */
export async function createApp() {
  const isProduction = process.env.NODE_ENV === "production";
  if (isProduction && !process.env.SESSION_SECRET) {
    throw new Error("SESSION_SECRET manquant : refus de démarrer en production avec un secret par défaut.");
  }

  const app = express();
  const httpServer = createServer(app);

  // Derrière le proxy de l'hébergeur (Traefik/Caddy sur Coolify) : nécessaire
  // pour les cookies « secure » et pour l'IP utilisée par la limitation de débit.
  if (isProduction) app.set("trust proxy", 1);

  // En-têtes de sécurité. La politique de contenu n'est stricte qu'en production
  // (le serveur de développement Vite a besoin de scripts inline et du websocket HMR).
  app.use(helmet({
    contentSecurityPolicy: isProduction ? {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
        imgSrc: ["'self'", "data:", "blob:"],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
        formAction: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
      },
    } : false,
    crossOriginEmbedderPolicy: false,
  }));

  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ extended: false }));

  const PgStore = connectPgSimple(session);
  app.use(session({
    store: new PgStore({ pool, tableName: "session", createTableIfMissing: false }),
    secret: process.env.SESSION_SECRET || "dispatch-dev-secret",
    proxy: isProduction,
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: isProduction,
      sameSite: "lax",
      httpOnly: true,
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 jours
    },
  }));

  app.use(passport.initialize());
  app.use(passport.session());
  setupPassport();

  // Journal d'accès minimal : jamais le corps des réponses (CV, emails, offres).
  app.use((req, res, next) => {
    const start = Date.now();
    const path = req.path;
    res.on("finish", () => {
      if (path.startsWith("/api")) log(`${req.method} ${path} ${res.statusCode} in ${Date.now() - start}ms`);
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

  await registerRoutes(httpServer, app);

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    // Les détails internes restent dans les logs, jamais dans la réponse.
    const message = status < 500 ? (err.message || "Requete invalide") : "Erreur serveur.";
    console.error("Internal Server Error:", err);
    if (res.headersSent) return next(err);
    return res.status(status).json({ message });
  });

  return { app, httpServer };
}
