# Last Changes

## 2026-07-27

### Refonte qualité moteur (phases 0-4 du plan d'audit)
- Quoi : refonte du moteur suite à l'audit qualité (CV incohérents, sortie générique)
- Fichiers : `server/tailoring-engine.ts`, `script/eval.ts`, `package.json`, `analysis/corpus/README.md`
- Impact :
  - **Phase 1 — modèles ciblés** : rédaction (summary, composer, reformulation fallback) et évaluateur `generated_cv_v1` passent sur `WRITER_MODEL`/`EVAL_MODEL` (défaut `gpt-4o`, overridable par env). Parsing/scoring restent sur mini. Température rédaction 0.45.
  - **Phase 2 — scoring sémantique embeddings** : `text-embedding-3-small` au tailor-time (1 appel batch, ~0 coût), cosine max bullet↔facettes de l'offre (intentions + responsibilities + roleFrame), remappé 0-30 points dans `totalScore`. Fallback silencieux si l'appel échoue. Dedup cross-expérience par cosine > 0.88 en plus du Jaccard.
  - **Phase 3 — scoring dégraissé** : cap déterministe 70→60, LLM 0-50→0-60 (le lexical ne domine plus), pré-filtre top-30→top-60 trié det+sémantique. `structuralCeiling` supprimé, `capPertinenceByWarnings` réduit à 3 caps (junior, PM, intégrité), clamps fins de `applyAssessmentGuardrails` supprimés (lead/niche/concept/scope) — warnings toujours émis pour l'UI. Échelle totalScore 120→150 recalée dans le report.
  - **Fix bug** : `dimCounts` de `selectBullets` était global → pénalisait les bullets des expériences suivantes et laissait des expériences vides. Maintenant par expérience.
  - **Phase 4 — composer** : `composeCVDocument` remplace `reformulateBullets` dans le pipeline optimisé — un seul appel qui réécrit résumé + bullets comme UN document cohérent (un auteur = cohérence narrative), validation déterministe par bullet (entités, distance, longueur) avec fallback bullet par bullet, fallback complet sur `reformulateBullets` si l'appel échoue.
  - **Phase 0 — harness d'éval** : `npm run eval` rejoue le corpus `analysis/corpus/` (fidèle + optimisé par offre), assertions dures de `calibration_targets_2026-04-05.md` codées (optimisé ≥ fidèle, bandes cibles, badges, intégrité). `npm run eval -- --export` exporte library + offres depuis la DB. Sorties dans `analysis/eval_runs/<ts>/`.
- Verification : `npm run check` et `npm run build` passent. **Le corpus réel n'a pas encore été rejoué** (OPENAI_API_KEY absent en local) — à faire avant tout déploiement : export corpus, renommage des offres, `npm run eval`.

## 2026-05-04

### Railway build fix
- Quoi : correction de la commande de build Railway pour installer les dependances optionnelles Linux requises par `esbuild`
- Fichiers : `railway.toml`, `.ai/TODO.md`, `.ai/LAST_CHANGES.md`
- Impact :
  - Railway n'utilise plus `npm install && npm run build`
  - le build passe par `npm ci --include=optional && npm run build` pour recuperer `@esbuild/linux-x64`
- Verification : non relancee localement

## 2026-04-13

### Tailoring Figma parity pass
- Quoi : realignement de `Tailoring` directement sur le frame Figma partage (sidebar, header compact, panneaux, mode, fast lane, repères utiles)
- Fichiers : `client/src/components/layout.tsx`, `client/src/pages/tailor.tsx`, `.ai/TODO.md`, `.ai/LAST_CHANGES.md`
- Impact :
  - sidebar desktop rapprochee du visuel Figma (fond clair, item actif gris, wordmark `dispatch.`, deconnexion discrete)
  - header global compact avec avatar seul a droite, plus proche du shell Figma
  - page `Tailoring` re-scalee sur la grille Figma desktop (`1427px`, rail droit `388px`, cartes a grands rayons et bordures legeres)
  - copy visible, hierarchie typo, modes `Fidele/Optimise`, fast lane et repères utiles recales sur le frame cible
  - `npm run dev` reste non validable en local sans `DATABASE_URL`, et le script actuel utilise encore une syntaxe POSIX non portable sous Windows
- Verification : `npm run check`, `npm run build`

### Tailoring UI fidelity pass (screenshots)
- Quoi : reconstruction de la page `Tailoring` pour coller au visuel cible (sidebar, header, cartes, fast lane, reperes utiles)
- Fichiers : `client/src/components/layout.tsx`, `client/src/pages/tailor.tsx`, `client/public/tailor-help-illustration.png`, `.ai/TODO.md`, `.ai/LAST_CHANGES.md`
- Impact :
  - sidebar desktop reconstruite avec la structure exacte attendue (`Super CV`, `Tailoring`, `Historique`, `Parametres`) et deconnexion ancree en bas
  - hierarchie visuelle et proportions de la page `Tailoring` realignees sur les captures (badge, hero, carte annonce, reglages, mode, rail droit)
  - bloc `Reperes utiles` refait avec l'illustration fournie (`Image 4`) en asset local public
  - comportement fonctionnel conserve (`pre-check`, generation, modal de confirmation, persistance des limites)
- Verification : `npm run check`, `npm run build`

## 2026-04-05

### Guardrails anti-faux-positifs
- Quoi : durcissement des caps structurels et de la lecture d'integrite texte apres les batches SocGen / Deel / Tomorro / Schneider / Lacoste
- Fichiers : `server/tailoring-engine.ts`, `.ai/TODO.md`, `.ai/LAST_CHANGES.md`
- Impact :
  - correction du sens du mismatch `junior/stage` : un profil trop senior pour le role remonte maintenant en `trop_junior` au lieu de passer entre les mailles
  - caps plus durs sur `lead_scope_underproven`, `niche_domain_underproven` et `junior_scope_mismatch`
  - `fitNiveau != coherent` ne peut plus sortir `probant`
  - bande haute resserree : `90+` devient beaucoup plus rare via nouveaux poids, plafond structurel et malus de survente plus fort
  - `textIntegrityScore` n'est plus calcule sur un texte trop propre : il prend maintenant en compte le corpus visible du document et des preuves selectionnees
  - un document ou pack clairement corrompu ne peut plus garder tranquillement `textIntegrityScore = 100`
- Verification : `npm run check`, `npm run build`

### Legitimite + optimise humain
- Quoi : durcissement du moteur contre les faux positifs de scope, et vrai contrat produit pour `optimise`
- Fichiers : `server/tailoring-engine.ts`, `client/src/pages/result.tsx`, `.ai/TODO.md`, `.ai/LAST_CHANGES.md`
- Impact :
  - `optimise` ne repart plus de la meme selection que `fidele` : il peut maintenant re-selectionner les preuves les plus convaincantes pour le role
  - le resume `optimise` a une consigne distincte, plus orientee legitimte humaine, sans droit de gonfler le scope
  - l'evaluateur compare des preuves source distinctes pour `fidele` et `optimise`, pas une seule base commune
  - ajout de warnings durs dans le moteur : `junior_scope_mismatch`, `lead_scope_underproven`, `pm_scope_underproven`, `niche_domain_underproven`, `text_integrity_issue`
  - ces warnings peuvent maintenant caper la `Pertinence` et empecher un badge `probant`
  - la page Result expose les warnings prioritaires, la decision moteur (`fidele`, `optimise retenu`, `optimise rejete`) et l'integrite texte
  - la synthese d'annonce fusionne `keywords critiques` et `skills requises` dans une seule lecture `Exigences de l'offre`
- Verification : `npm run check`, `npm run build`

### Grounded quality pass
- Quoi : correctifs concrets sur la qualite documentaire et la lecture du scope, sans relancer une refonte
- Fichiers : `server/tailoring-engine.ts`, `.ai/TODO.md`, `.ai/LAST_CHANGES.md`
- Impact :
  - nettoyage d'encodage / mojibake branche tres tot dans le pipeline (`jobText`, experiences, bullets, skills, CV structure, rendu final)
  - selection de bullets legerement durcie pour privilegier les preuves specifiques au role et reduire les bullets "bons partout"
  - garde-fous contextuels `lead` / `PM` au moment de l'application de l'assessment final
  - un role `lead` proche metier mais faible en preuves de scope ne monte plus aussi facilement en `probant`
  - un role `PM` sans vraies preuves PM reste freine meme si quelques signaux produits existent
  - `whatMatches` / `whatMissing` / `nextActions` sont maintenant regeneres depuis l'etat final pour eviter les contradictions score / verdict
- Verification : `npm run check`, `npm run build`

### Calibration pass grounded
- Quoi : recalibrage du moteur visible autour de `credibility + grounding + overstatement`, durcissement du badge, alignement du pre-check et ajout d'une cible de calibration versionnee
- Fichiers : `server/tailoring-engine.ts`, `server/routes.ts`, `client/src/pages/tailor.tsx`, `client/src/hooks/use-tailor.ts`, `client/src/pages/result.tsx`, `analysis/calibration_targets_2026-04-05.md`, `CLAUDE.md`, `.ai/TODO.md`
- Impact :
  - `Pertinence` n'est plus lue telle quelle depuis le LLM : elle est recalculee server-side depuis `fitMetier`, `recruiterCredibilityScore`, `evidenceGrounding`, `atsReadiness` et un malus fort `overstatementRisk`
  - cap visible par distance metier : `adjacent <= 78`, `different <= 35`
  - badge `probant` reserve aux documents vraiment credibles, bien ancres et peu survendus
  - diagnostic serveur reconstruit depuis une matrice simple pour eviter les contradictions score / verdict
  - guard `optimise` vs `fidele` freine aussi les regressions de risque de survente
  - `/api/check-match` expose maintenant `precheckVerdict` (`go / prudence / faible_chance`) et raconte enfin la meme philosophie produit que la page Result
  - la page Result met davantage en avant l'ancrage preuves, la credibilite et le risque de survente; l'ATS reste visible mais secondaire
  - ajout d'un artefact de calibration partageable dans `analysis/`
- Verification : `npm run check`, `npm run build`

### Grounded score reset
- Quoi : sortie du score visible hors du `ProfileFrame` / `fitMetier` theorique, et remplacement par une evaluation du CV genere
- Fichiers : `server/tailoring-engine.ts`, `client/src/pages/result.tsx`, `client/src/pages/tailor.tsx`, `CLAUDE.md`, `.ai/TODO.md`
- Impact :
  - `runTailorPipeline` n'utilise plus `ProfileFrame` comme source souveraine du score visible
  - le moteur evalue `fidele` et `optimise` dans le meme passage (`generated_cv_v1`)
  - le guard anti-regression choisit la version finale sur `pertinence + credibiliteCv + ATS final`
  - fallback legacy conserve si l'evaluateur du document final tombe
  - la page Result explique mieux la logique `document final + preuve source`
  - la modale de pre-check rappelle que le score avant generation reste un triage rapide, pas le verdict final
- Verification : `npm run check`, `npm run build`

### V3 visible rollout
- Quoi : activation complete de la V3 dans le pipeline et la page Result
- Fichiers : `server/tailoring-engine.ts`, `client/src/pages/result.tsx`
- Impact :
  - score visible = `pertinence`
  - badge visible = `probant` / `a_renforcer` / `fragile`
  - export IA enrichi avec `fitMetier`, `forcePreuve`, `credibiliteCv`, `distanceDomain`
  - fallback legacy conserve pour anciens runs
- Verification : `npm run check`, `npm run build`

### Memoire projet compacte
- Quoi : reduction volontaire de `CLAUDE.md`, `.ai/TODO.md`, `.ai/LAST_CHANGES.md`
- Fichiers : `CLAUDE.md`, `.ai/TODO.md`, `.ai/LAST_CHANGES.md`
- Impact :
  - philosophie V3 rendue explicite
  - duplication et historique verbeux supprimes
  - rappel court des approches a ne pas retester aveuglement
  - reprise d'agent moins couteuse en tokens
- Verification : revue manuelle

### CLAUDE.md re-equilibre
- Quoi : re-ajout des nuances produit essentielles apres une compression trop forte
- Fichiers : `CLAUDE.md`
- Impact :
  - mission "mass apply" mieux explicitee
  - distinction plus nette entre `pertinence`, badge document, ATS et preuves
  - garde-fous de rollout et questions encore ouvertes rendus plus visibles
- Verification : revue manuelle

### Review pass et coherence V3
- Quoi : revue complete du branchement V3 + corrections de coherence visibles
- Fichiers : `server/tailoring-engine.ts`, `client/src/pages/history.tsx`, `client/src/pages/tailor.tsx`, `.ai/TODO.md`
- Impact :
  - `fitNiveau` lit maintenant `job.seniority` au lieu de s'appuyer seulement sur `roleFrame.scopeSignals`
  - l'historique affiche `pertinence` quand elle existe, avec fallback legacy
  - le wording du pre-check est clarifie comme estimation de triage
  - les risques encore ouverts (`ProfileFrame` fallback, pre-check legacy) sont notes dans `TODO`
- Verification : `npm run check`, `npm run build`

### Naming UI harmonise
- Quoi : harmonisation du vocabulaire visible entre navigation, pages et tabs clefs
- Fichiers : `client/src/components/layout.tsx`, `client/src/pages/library.tsx`, `client/src/pages/history.tsx`, `client/src/pages/tailor.tsx`, `client/src/pages/result.tsx`
- Impact :
  - nav gauche : `Super CV`, `Tailoring`, `Historique`
  - bibliotheque : entree page `Super CV` + section `Experiences`
  - history : labels, CTA et etats vides alignes en francais
  - result : tab source renommee `Super CV utilise`
- Verification : revue manuelle + `npm run check`, `npm run build`

### Tailor fast lane UI
- Quoi : refonte ergonomique de la page `Tailoring` pour un usage plus rapide, plus compact et plus scannable
- Fichiers : `client/src/pages/tailor.tsx`, `.ai/backups/tailor-page-2026-04-05.tsx`, `.ai/TODO.md`
- Impact :
  - gros formulaire vertical remplace par un workspace principal + rail lateral sticky
  - annonce gardee au centre, reglages et CTA compactes sur le cote
  - meme logique produit conservee, sans changement du flow de generation
  - backup exact de la version precedente garde dans `.ai/backups/`
- Verification : `npm run check`, `npm run build`

### History triage UI
- Quoi : refonte ergonomique de la page `Historique` pour un triage plus rapide et plus lisible
- Fichiers : `client/src/pages/history.tsx`, `.ai/backups/history-page-2026-04-05.tsx`, `.ai/TODO.md`
- Impact :
  - hero plus utile avec resume rapide et CTA clair
  - lignes d'historique restructurees autour du poste, du mode, du statut, de la pertinence et du badge document
  - informations V3 mieux visibles sans noyer l'utilisateur dans des micro-details
  - mojibake `Postule` corrige au passage
  - backup exact de la version precedente garde dans `.ai/backups/`
- Verification : `npm run check`, `npm run build`

## 2026-04-04

### Reliability pass
- Quoi : quality gate de scrape, pre-check nuance, non-regression plus stricte, nettoyage d'encodage, corrections build/check
- Fichiers : `server/routes.ts`, `server/tailoring-engine.ts`, `client/src/pages/result.tsx`, `client/src/pages/tailor.tsx`, `server/index.ts`, `tsconfig.json`
- Impact :
  - meilleur signal scrape
  - moins de faux warnings pre-check
  - base locale `check/build` propre
  - auth/session Railway plus robuste
- Verification : `npm run check`, `npm run build`

## Note
- Historique ancien volontairement purge.
- Si un detail manque, regarder `git log` / le diff plutot que regonfler ce fichier.
