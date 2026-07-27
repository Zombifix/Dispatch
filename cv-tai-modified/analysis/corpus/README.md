# Corpus d'évaluation

Harness : `npm run eval` (voir `script/eval.ts`).

## Setup (une fois)
1. `npm run eval -- --export` avec `DATABASE_URL` → exporte `library.json` + les offres depuis `job_posts`.
2. Renommer les fichiers dans `offers/` avec les noms du corpus de calibration (`alan.json`, `thales.json`, `beelix.json`, `behaviour.json`, `edf.json`, `thefork.json`, `razer.json`, `edtech.json`) pour activer les bandes cibles automatiques.
3. `OPENAI_API_KEY` requis pour rejouer.

## Format offre (`offers/<nom>.json`)
```json
{
  "name": "thales",
  "jobText": "…texte brut de l'annonce…",
  "expected": { "min": 72, "max": 82, "badges": ["a_renforcer", "probant"] }
}
```
`expected` optionnel — override des bandes par défaut (issues de `analysis/calibration_targets_2026-04-05.md`).

## Assertions codées en dur
- `optimise` jamais < `fidele` (pertinence)
- pertinence dans la bande cible, badge dans les badges attendus
- zéro artefact d'encodage dans le document final

## Sorties
`analysis/eval_runs/<timestamp>/` : CV fidèle + optimisé (.txt), rapports complets (.json), `_summary.json`.
Exit code 1 si au moins une offre sort des clous → utilisable en CI.

## Règle produit
Toujours relire les CV générés, pas seulement les scores (doctrine CLAUDE.md).
