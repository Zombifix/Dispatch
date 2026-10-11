import { build as esbuild } from "esbuild";
import { build as viteBuild } from "vite";
import { rm, readFile } from "fs/promises";

// Dépendances serveur intégrées au bundle (démarrage plus rapide).
// pdf-parse reste externe : il lit des fichiers relatifs à son propre dossier.
const bundled = new Set([
  "connect-pg-simple",
  "drizzle-orm",
  "drizzle-zod",
  "express",
  "express-session",
  "openai",
  "passport",
  "passport-local",
  "pg",
  "zod",
]);

async function buildAll() {
  await rm("dist", { recursive: true, force: true });

  console.log("building client...");
  await viteBuild();

  console.log("building server...");
  const pkg = JSON.parse(await readFile("package.json", "utf-8"));
  const allDeps = [
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.devDependencies || {}),
    "nanoid",
  ];
  const externals = allDeps.filter((dep) => !bundled.has(dep));

  await esbuild({
    entryPoints: ["server/index.ts"],
    platform: "node",
    target: "node22",
    bundle: true,
    format: "cjs",
    outfile: "dist/index.cjs",
    define: {
      "process.env.NODE_ENV": '"production"',
    },
    minify: true,
    sourcemap: true,
    external: externals,
    logLevel: "info",
  });
}

buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
