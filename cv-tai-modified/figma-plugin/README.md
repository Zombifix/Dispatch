# Plugin Figma privé « Dispatch — remplir mon CV »

Remplit ton template de CV Figma avec le CV produit par Dispatch, sans copier-coller section par section. Le plugin ne fait aucun appel réseau : tu colles le contenu exporté.

## Installation (une fois)
1. Figma desktop → menu **Plugins → Development → Import plugin from manifest…**
2. Choisir `cv-tai-modified/figma-plugin/manifest.json`.

Pas de publication nécessaire : le plugin reste privé à ton compte.

## Préparer le template (une fois)
Renomme les calques de ton template avec ces noms (le texte actuel sert de style) :

| Calque | Contenu |
| --- | --- |
| `#name` | nom |
| `#title` | titre (celui de l'angle choisi) |
| `#summary` | résumé |
| `#skills` | compétences, séparées par « · » |
| `#languages`, `#formations` | langues, formations |
| `#label.summary`, `#label.experience`, `#label.skills`, `#label.education`, `#label.languages` | titres de sections dans la langue du CV |
| `#exp` | **cadre** d'une expérience, dupliqué autant de fois que nécessaire (auto-layout conseillé) |
| `#exp.title`, `#exp.company`, `#exp.dates`, `#exp.contract` | textes dans `#exp` |
| `#exp.bullets` | un texte dans `#exp` : une ligne « • » par bullet |
| ou `#bullet` | cadre (avec un texte `#bullet.text`) ou texte, dupliqué pour chaque bullet |

Un seul `#exp` suffit : il sert de modèle. Les expériences en trop sont créées en dessous, dans le même parent. Avec un auto-layout vertical, la page se met en forme toute seule.

## Utilisation
1. Dans Dispatch, page résultat : bouton **Pour Figma** (copie le contenu).
2. Dans Figma : sélectionne le cadre de ton CV, lance le plugin, colle, **Remplir le template**.
3. Le rapport liste les calques introuvables et les polices manquantes.

## Pour les candidatures via formulaire (ATS)
L'export PDF de Figma écrit le texte en formes vectorisées : beaucoup d'ATS le lisent mal. Pour un dépôt sur un site carrière, utilise le bouton **Word (ATS)** de Dispatch. Garde la version Figma pour les envois directs à une personne.
