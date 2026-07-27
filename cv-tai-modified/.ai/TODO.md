# TODO

## Current focus (refonte qualité 2026-07-27)
- Refonte moteur appliquée (voir LAST_CHANGES 2026-07-27) : modèles ciblés gpt-4o (rédaction + éval), embeddings sémantiques dans le scoring, caps dégraissés (3 caps durs restants), fix dedup dimension, composer document entier en mode optimisé, harness `npm run eval`
- **PROCHAINE ÉTAPE OBLIGATOIRE** : rejouer le corpus réel avant déploiement
  1. `npm run eval -- --export` (avec DATABASE_URL)
  2. renommer les offres exportées (alan, thales, beelix, behaviour, edf, thefork, razer, edtech)
  3. `npm run eval` (avec OPENAI_API_KEY) et relire les CV générés, pas que les scores
- Attendu : Thales/Beelix remontent (adjacents sans keywords exacts), plus de `polished < original`, EDF/Behaviour restent bas

## Ancien focus
- Le score visible est maintenant recable sur une evaluation du CV genere, pas sur `ProfileFrame`
- Le score visible est un triage; le CV reste le vrai produit
- Calibration V3 recentree sur `fitMetier + recruiterCredibilityScore + evidenceGrounding`, avec `overstatementRisk` comme frein reel
- Nouveau pass grounded : nettoyage d'encodage, selection moins generique et garde-fous `lead` / `PM`
- Nouveau pass legitimite : `optimise` peut maintenant re-selectionner les preuves, pas seulement rewriter les memes bullets
- Warnings durs visibles : `junior_scope_mismatch`, `lead_scope_underproven`, `pm_scope_underproven`, `niche_domain_underproven`, `text_integrity_issue`
- Nouveau pass anti-faux-positifs : caps plus durs sur `junior/stage`, `lead underproven`, `niche underproven` et bande haute `90+` davantage reservee

## In progress
- Pipeline refactorise : evaluation `fidele` / `optimise` dans le meme passage
- `Pertinence` et badge document derives du document final + preuve source
- Badge durci : `probant` devient conservateur
- Pre-check recable en verdict produit `go / prudence / faible_chance`
- `Optimise humain` : selection dediee + summary dedie + reformulation plus ambitieuse mais toujours ancree
- La page Result affiche maintenant la decision moteur (`fidele` / `optimise rejete` / `optimise retenu`) et les warnings prioritaires
- Page `Tailoring` refondue en mode fast lane, avec backup local de l'ancienne version
- Page `Historique` refondue pour un triage plus rapide, avec backup local de l'ancienne version
- `npm run check` et `npm run build` passent
- Rebuild fidelity de l'ecran `Tailoring` depuis le frame Figma (sidebar + header compact + grille + mode + fast lane + repères utiles)

## Next
- Rejouer le batch grounded : `Alan`, `Thales`, `Beelix`, `TheFork`, `Razer`, `Behaviour`, `EdTech`, `EDF`
- Verifier que `Pertinence` suit enfin la qualite du CV genere sur ces cas
- Verifier que `analysis/calibration_targets_2026-04-05.md` tient bien sur les runs reels
- Verifier la nouvelle ergonomie Tailor sur desktop + mobile avec un vrai usage rapide
- Verifier la nouvelle ergonomie Historique sur desktop + mobile avec un vrai usage de triage
- Verifier `0` cas `polished < original`
- Verifier que les hors-scope restent bas sans faux positifs
- Verifier que les adjacents credibles remontent sans survente
- Verifier le badge document contre la qualite humaine reelle du CV
- Verifier que les roles `lead` proches metier mais faibles en scope redescendent en `a_renforcer`
- Verifier que la selection garde moins de bullets "bons partout" et plus de preuves specifiques au role
- Verifier que `optimise` change vraiment la strategie de preuve sur les cas proches, pas juste le wording
- Verifier que `optimise` ne sort plus inferieur a `fidele` sur `Cdiscount`, `Dashlane`, `Skillcorner`, `Lacoste`
- Verifier que `textIntegrityScore` descend vraiment quand le pack ou le document contient encore du mojibake
- Verifier que `junior/stage` ne peut plus coexister avec `93 probant`
- Verifier que `fitNiveau != coherent` ne peut plus produire un badge `probant`
- Verifier la coherence inter-source sur les doublons d'offre
- Verifier le pre-check et `scrapeQuality` sur des annonces propres vs bruitees
- Clarifier la source des bullets dupliques dans le pack debug / export review

## Known risks / checks
- Le pre-check garde encore un coeur legacy pour la vitesse, meme si son langage produit est maintenant aligne
- L'evaluateur `generated_cv_v1` reste un appel LLM : toujours garder le fallback legacy et controler ses sorties
- `fitMetier` ne doit plus redevenir une theorie sur le profil; il doit rester ancre dans le CV final + les bullets source
- `Badge document` doit rester conservateur
- `ATS` reste utile mais ne doit plus remonter artificiellement des documents mal ancres
- Le fix d'encodage repare la plupart des mojibake courants, mais ne peut pas ressusciter un caractere deja perdu en amont du scrape
- Les garde-fous `lead` / `PM` sont generiques : surveiller toute sur-correction sur des roles hybrides
- Les warnings durs doivent rester des caps generiques, pas devenir des cas speciaux caches par annonce
- Le pack debug peut encore raconter une fausse histoire si la provenance des bullets selectionnes est polluee par des doublons inter-experiences
- Le calcul d'integrite texte est maintenant volontairement plus dur : surveiller toute sur-penalisation si seul le debug est corrompu mais pas le CV final
- Auth toujours non multi-tenant (`userId` absent des tables coeur)
- Railway peut encore diverger local/prod sur cookies et version Node
- Railway build command corrigee dans `railway.toml` pour installer les optional deps Linux (`npm ci --include=optional`)
- Le lancement local du serveur reste bloque sans `DATABASE_URL`, et `npm run dev` garde une syntaxe d'env POSIX non portable sur Windows

## Do not repeat blindly
- Relever / baisser des caps sur quelques cas design a deja cree de l'overfit
- Laisser `evidence` ecraser tout le reste a deja produit des cliff effects
- Basculer l'UI avant validation batch a deja cree du drift entre moteur et facade
- Faire du `ProfileFrame` visible la source principale du score a deja donne des scores absurdes sur des cas proches
- Juger `fidele` et `optimise` dans deux logiques differentes a deja cree du drift et des regressions inutiles
- Lire un `ATS 100` comme un succes produit a deja masque des CV trop survendus

## Touched files
- `client/src/components/layout.tsx`
- `client/src/pages/library.tsx`
- `client/src/pages/history.tsx`
- `.ai/backups/history-page-2026-04-05.tsx`
- `server/tailoring-engine.ts`
- `client/src/pages/result.tsx`
- `server/routes.ts`
- `client/src/pages/tailor.tsx`
- `client/src/hooks/use-tailor.ts`
- `.ai/backups/tailor-page-2026-04-05.tsx`
- `CLAUDE.md`
- `.ai/TODO.md`
- `.ai/LAST_CHANGES.md`
- `analysis/calibration_targets_2026-04-05.md`
- `client/public/tailor-help-illustration.png`

## Product backlog
- [ ] Autocompletion des tags
- [ ] Scraping fallback propre
- [ ] Multi-user / auth
- [ ] Accept / reject bullet
- [ ] Embeddings semantiques (`pgvector`)
