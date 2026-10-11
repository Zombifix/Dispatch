# Dispatch — CV modulable

Mémoire canonique du projet pour les humains et les agents. C'est le seul fichier d'instructions : `AGENTS.md` renvoie ici.

## Le produit en une phrase
L'utilisateur écrit une bibliothèque d'arguments (faits + formulations). Pour chaque offre, Dispatch **assemble** le meilleur CV à partir de ces arguments, explique chaque choix, et ne fait intervenir l'IA que là où elle apporte quelque chose, toujours de façon visible et réversible.

## Objectif nord
Un CV que l'utilisateur peut envoyer sans relecture lourde, qui passe le parsing ATS et qui sonne comme lui, pas comme un modèle.

## Doctrine (ne pas dévier)
1. **Le produit, c'est le CV généré.** Les scores sont des repères de triage, jamais l'objectif d'optimisation.
2. **L'utilisateur écrit, le moteur choisit.** Le LLM ne réécrit jamais la bibliothèque. Il tague, évalue, propose ; l'utilisateur accepte ou non.
3. **Assemblage d'abord, IA ensuite.** Sélection, ordre, budget, titre, compétences : déterministe. L'IA sert à comprendre l'offre et à proposer des retouches ponctuelles avec diff.
4. **Rien qui ne vienne pas de l'utilisateur.** Jamais de compétence ajoutée parce que l'offre la cite, jamais le titre de l'offre comme titre du CV, jamais de métrique, produit ou scope inventés.
5. **Une langue par CV.** Jamais de mélange.
6. **Chaque ligne a une raison lisible** (must-have couvert, angle, preuve chiffrée).
7. **Le style IA est un défaut** : verbes en tête identiques, longueurs uniformes, formules creuses. Le linter les signale.

## Ce qu'il ne faut plus faire
- Retoucher des seuils de score à la main sur quelques offres (overfit constaté en 2026).
- Déployer une modification du moteur sans rejouer le corpus (`npm run eval`) et **lire** les CV produits.
- Laisser un modèle réécrire tout le document en un passage.
- Utiliser `drizzle-kit push` sur une base réelle : toujours `npm run db:generate` puis migration versionnée.
- Committer un secret, un fichier `.env`, un dump, un fichier de session d'agent ou une sauvegarde de page.

## Architecture
- `cv-tai-modified/` : l'application (nom historique du dossier).
- Serveur : Express 5 + TypeScript (`server/`). Client : React 18 + Vite + Tailwind (`client/src/`). Base : PostgreSQL via Drizzle (`shared/schema.ts`, migrations dans `migrations/`).
- LLM : interface unique `server/llm.ts` (fournisseur compatible OpenAI configurable, sorties structurées validées par Zod, quota par utilisateur).
- Déploiement : Docker sur VPS via Coolify (`docs/DEPLOY_VPS.md`).

## Fichiers clés
| Fichier | Rôle |
| --- | --- |
| `shared/schema.ts` | schéma de base, source unique |
| `server/tailoring-engine.ts` | pipeline historique (mode fidèle / optimisé) |
| `server/assembler.ts` | assemblage déterministe (mode recommandé) |
| `server/cv-lint.ts` | linter anti-CV générique |
| `server/job-input.ts` | récupération et nettoyage des annonces |
| `server/llm.ts` | accès LLM, cache, quotas |
| `server/routes.ts` | API |
| `client/src/pages/library.tsx` | bibliothèque (faits, variantes) |
| `client/src/pages/tailor.tsx`, `result.tsx` | génération et résultat |
| `figma-plugin/` | plugin Figma privé de remplissage du template |

## Commandes
```
npm run dev          # serveur + client en développement (DATABASE_URL requis)
npm run check        # typecheck
npm test             # tests (TEST_DATABASE_URL pour les tests de migration)
npm run build        # build production
npm run db:generate  # nouvelle migration après modification du schéma
npm run db:migrate   # appliquer les migrations
npm run eval         # rejouer le corpus d'évaluation (voir analysis/corpus/README.md)
```

## Reprise rapide pour un agent
1. Lire ce fichier, puis `docs/AUDIT-2026-10-11.md` (§0 et §12) pour le contexte.
2. `git log --oneline -20` et `git status`.
3. Toute modification passe `npm run check` et `npm test` avant commit.
