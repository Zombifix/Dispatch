# Dispatch — Design System

**DA v2 (actuelle)** : style "dashboard" clair — page bleutée avec halo, cartes blanches à ombre douce,
sidebar pleine hauteur sans libellé de section, en-têtes sans pastille, stats groupées dans une carte,
listes en lignes (référence : capture "Candidatures récentes" validée en oct. 2026).

Le Figma `YJmfPIN235xRo0TZQcEYpx` (page "Ecran" `67:632`) reste la référence de **structure et de contenu**
des écrans (Login, Tailoring, Résultat, Historique) ; la page "Asset" (`67:2157`) fournit logo et mascotte.
Quand Figma et la DA v2 divergent visuellement, la DA v2 l'emporte.

## Règle d'or

> Dans `pages/`, **aucune** valeur en dur : pas de `#hex`, pas de `rgba()`, pas de `text-[13px]`,
> pas de `rounded-[19.37px]`, pas de `style={{ color }}`. Si un besoin n'est pas couvert,
> on ajoute un token dans `tailwind.config.ts` / `index.css`, pas une valeur locale.
> Seule exception : largeurs dynamiques (`style={{ width: pct + "%" }}`) pour les barres de score.

Quand la maquette diverge d'elle-même (ex : 3 bleus différents, 2 styles de bouton outline),
**on impose la variante du design system** et on arbitre plus tard dans Figma.

## Tokens (index.css → tailwind)

| Rôle | Classe | Valeur |
|---|---|---|
| Fond de page (blanc bleuté) + halo | `bg-background` / `.bg-app` | #f5f8fd |
| Surfaces au-dessus de la page (cartes, champs, dialogs, menus) | `bg-card` | #ffffff |
| Texte principal | `text-foreground` | #0f1729 |
| Texte secondaire | `text-muted-foreground` | #65758b |
| Primaire | `bg-primary` / `text-primary` | #2563eb |
| Primaire foncé (fin de gradient, texte sur soft) | `primary-strong` | #1d4ed8 |
| Primaire doux (chip FR, fonds) | `bg-primary-soft` | #dbeafe |
| Bordure | `border-border` (souvent `/70` ou `/60`) | #e1e7ef |
| Sidebar | `bg-surface` | #fbfcfe |
| Champ rempli (auth) | `bg-field` | #f5f7fb |
| Fond neutre (chips, pistes de barres) | `bg-secondary` | #f1f5f9 |
| Succès | `success` / `success-strong` / `success-soft` | #22c55e / #15803d / #dcfce7 |
| Attention | `warning` / `warning-strong` / `warning-soft` | #d97706 / #b45309 / #fef3c7 |
| Erreur | `destructive` / `destructive-soft` | #dc2626 / #fef2f2 |
| Info (mode optimisé) | `info` / `bg-info-soft` | #1fb3c7 |

Pas de page en blanc pur : la page est en `bg-background` (bleuté), les cartes blanches posées dessus en `bg-card`.
N'utilise jamais `bg-background` pour une carte ou un champ (elle se confondrait avec la page).

Couleurs de score : toujours via `lib/score.ts` (`scoreTone`) — `>= 78` → `success`, `>= 45` → `warning`,
sinon `destructive`, alignées sur les libellés "Fit fort / partiel / faible". Même règle sur tous les écrans.

### Radius
`rounded-xs` 4 · `rounded-sm` 6 (tabs, tags) · `rounded-md` 10 (petits boutons, items de menu) ·
`rounded-lg` 12 (boutons, nav, inputs) · `rounded-xl` 12 · `rounded-2xl` 16 (cartes, lignes) ·
`rounded-3xl` 20 (panneaux de section) · `rounded-4xl` 24 (cadre auth) · `rounded-full` (pills).

### Typo (Plus Jakarta Sans)
- Titre de page : `PageHeader` (44px extrabold) précédé d'un eyebrow texte simple (pas de pastille)
- Titre de section : `text-2xl font-semibold tracking-[-0.025em]` (ou `SectionTitle`)
- Titre de carte : `text-xl font-semibold tracking-[-0.025em]` (ou `CardTitle`)
- Corps : `text-base text-muted-foreground leading-6` ; petit : `text-sm`
- Eyebrow (labels uppercase) : `<Eyebrow>` (14px, 0.2em) / `<Eyebrow size="sm">` (12px)
- Micro (chips, méta) : `text-2xs` (12px) — **plancher de lisibilité : rien sous 12px**

### Ombres / fonds
`shadow-cta` (CTA large) · `shadow-cta-sm` · `shadow-nav` · `shadow-document` · `shadow-xs` ·
`bg-cta-gradient` · `bg-highlight-panel` (panneau "Lancer le tailoring") ·
`shadow-card` (ombre douce bleutée des cartes) · `surface-card` (blanc + bord /70 + shadow-card) ·
`surface-tint` (bleu très clair, panneaux d'aide) · `.bg-app` (fond de page : halo bleu + texture douce —
semis de points bleus estompé, plus présent en bas à droite, et grain très fin ; ne pas l'alourdir).

## Composants — toujours les utiliser

| Besoin | Composant |
|---|---|
| Toute action cliquable | `Button` — `default` (CTA gradient), `soft` (bleu clair : "Voir l'analyse →"), `outline` (blanc bordé : retour, pagination, "J'ai postulé"), `secondary`, `ghost`, `link`, `destructive`. Tailles `sm` 32 · `default` 40 · `lg` 48 (CTA de page) · `icon` / `icon-sm`. |
| Action de ligne "Voir l'analyse →" | `<Button variant="soft">` |
| Statut / chip | `Badge` — `info` (Optimisé), `success`, `warning` (À renforcer), `destructive` (Fragile), `secondary` (neutre), `primary` (langue), `outline` (Voir l'annonce), `tag` (compétence dans le CV) |
| Conteneur | `Card` — `default` (16, lignes / petites cartes), `panel` (20, sections), `tint` (aide), `inset`, `document` |
| Champs | `Input` (`variant="filled"` en auth, `inputSize="sm"` en dense), `Textarea`, `Switch` |
| Onglets / segmented | `Tabs`, `TabsList`, `TabsTrigger` |
| En-tête de page | `PageHeader` (eyebrow + titre + sous-titre + actions) |
| Sous-titre de section | `SectionTitle`, `Eyebrow` |
| KPI | `StatGroup` (une carte, items séparés, icône dans une tuile bleue ; `onClick` + `active` → filtre). |
| Choix exclusif entre 2–3 options | `Segmented` (jamais un `Switch`, réservé au on/off) |
| Logo | `components/brand/logo.tsx` → `<Logo />` |
| Logo d'entreprise | `CompanyAvatar` (logo récupéré sans IA côté serveur : JSON-LD `hiringOrganization.logo` → logo LinkedIn → favicon du site de l'entreprise ; repli sur l'initiale) |
| Mascotte | `components/brand/mascot.tsx` → `<Mascot variant="megaphone" \| "cv" \| "thinking" flip />` |

### Mascotte — où
- `megaphone` : panneaux d'aide / conseils (Tailoring → "Repères utiles")
- `cv` : scores, enrichissement (carte "Enrichis ton Super CV" en bas de la sidebar)
- `thinking` : questions, suivi, états vides (Résultat → "Suivi de candidature", empty states)

Les fichiers sont dans `client/public/illustrations/` (512 px, exportés depuis la page Asset).
Ne jamais référencer les PNG directement.

## Layout
- `Layout` : fond `.bg-app`, sidebar pleine hauteur (`bg-surface` + bordure droite, 248 px) dès 1440 px (`wide:`),
  barre d'icônes (88 px) entre `lg` et 1440 px, tiroir en mobile. Pas de libellé "Navigation".
  Compte en haut à droite (carte blanche, initiales) = menu du compte. Contenu `max-w-content` (1427 px).
- Toutes les pages utilisent la largeur : colonne principale `flex-1` + aside sticky
  (Tailoring 388 px, Résultat 384 px, Super CV 420 px) ; Paramètres en grille 2 colonnes.
- Listes de candidatures : lignes (`Card` default) — identité · Pertinence · ATS · statut · action.

## Règles d'UX
- Une action non branchée ne s'affiche pas (pas de faux bouton).
- Un seul bouton `default` (gradient) par zone ; les actions secondaires en `outline`/`ghost`.
- Les métriques internes du moteur (sous-scores, debug) ne sont visibles qu'en dev ou avec
  `localStorage["dispatch:debug"] = "1"`.
- Cibles tactiles : 44 px minimum en mobile.
