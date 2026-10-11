import { createApp, log } from "./app";
import { serveStatic } from "./static";
import { pool } from "./db";
import { runMigrations } from "./migrate";

(async () => {
  await runMigrations(pool);
  const { app, httpServer } = await createApp();

  // Client : fichiers construits en production, Vite en développement
  // (après les routes API pour que le catch-all ne les masque pas).
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen({ port, host: "0.0.0.0" }, () => log(`serving on port ${port}`));
})();
