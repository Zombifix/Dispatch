# Déployer Dispatch sur le VPS (Coolify)

Ce guide remplace l'ancien déploiement Railway. Il suppose un VPS Linux avec au moins **2 vCPU et 4 Go de RAM** (Coolify consomme environ 800 Mo à lui seul, et le build Vite manque de mémoire sous 4 Go).

L'application est livrée avec :

- un `Dockerfile` multi-étapes (build puis runtime minimal, utilisateur non root, healthcheck intégré) ;
- des migrations versionnées dans `migrations/`, appliquées automatiquement au démarrage ;
- une route `GET /healthz` qui vérifie aussi la base ;
- un `.env.example` qui liste toutes les variables.

---

## 1. Préparer le serveur (une fois)

```bash
# Sur le VPS, en root
apt update && apt upgrade -y
apt install -y ufw unattended-upgrades
ufw allow 22/tcp && ufw allow 80/tcp && ufw allow 443/tcp && ufw --force enable
dpkg-reconfigure -plow unattended-upgrades

# SSH : connexion par clé uniquement
sed -i 's/^#\?PasswordAuthentication .*/PasswordAuthentication no/' /etc/ssh/sshd_config && systemctl restart ssh

# Coolify (script officiel)
curl -fsSL https://cdn.coollabs.io/coolify/install.sh | bash
```

Ouvrir `http://<IP_DU_VPS>:8000`, créer le compte administrateur, **activer la double authentification**, puis dans Settings définir le domaine de l'instance Coolify.

## 2. Base de données

1. Coolify → Project → New Resource → **PostgreSQL 16**.
2. Noter l'URL **interne** (de la forme `postgres://postgres:<mot-de-passe>@<nom-du-conteneur>:5432/postgres`).
3. Ne **pas** exposer le port publiquement.

### Sauvegardes (obligatoire)

1. Créer un bucket S3 externe au VPS (Hetzner Object Storage, Scaleway Object Storage ou Cloudflare R2).
2. Coolify → Settings → S3 Storages → ajouter et **valider** le bucket.
3. Sur la base : Backups → planification `0 3 * * *`, rétention 14.
4. Lancer une sauvegarde manuelle, puis **tester une restauration** sur une base temporaire. Une sauvegarde jamais restaurée n'est pas une sauvegarde.

## 3. Application

1. Coolify → New Resource → Application → **GitHub App** (dépôt `Zombifix/Dispatch`, branche `main`).
2. Build Pack : **Dockerfile**. Base Directory : `/cv-tai-modified`. Dockerfile : `Dockerfile`.
3. Ports Exposes : `5000`.
4. Health Check : chemin `/healthz`, port `5000`.
5. Domaine : renseigner le FQDN (`https://cv.mondomaine.fr`). Le certificat Let's Encrypt est automatique.
6. Variables d'environnement (onglet Environment Variables, toutes en **Build: off / Runtime: on**) :

| Variable | Valeur |
| --- | --- |
| `DATABASE_URL` | l'URL interne de l'étape 2 |
| `SESSION_SECRET` | `openssl rand -hex 32` (nouvelle valeur, jamais réutilisée) |
| `OPENAI_API_KEY` | la **nouvelle** clé (l'ancienne doit être révoquée) |
| `INVITE_CODE` | un code pour limiter les inscriptions |
| `LLM_DAILY_QUOTA` | `200` (appels LLM max par utilisateur et par jour) |
| `LLM_BASE_URL`, `LLM_MODEL`, `WRITER_MODEL`, `EVAL_MODEL`, `EMBEDDING_MODEL` | optionnels, voir `.env.example` |

7. Deploy. Les logs doivent montrer `[MIGRATE] Schéma à jour` puis `serving on port 5000`.
8. Auto-deploy sur push : activé par défaut avec la GitHub App.

## 4. Récupérer les données de l'ancienne instance Railway

Uniquement si la base Railway existe encore. **Faire tourner son mot de passe d'abord** (il a été publié dans le dépôt), puis récupérer la nouvelle URL publique dans Railway → Postgres → Connect.

```bash
# Sur ton poste ou sur le VPS
pg_dump -Fc --no-owner --no-acl "$RAILWAY_PUBLIC_DATABASE_URL" -f dispatch-railway.dump

# Restauration dans la base Coolify (depuis le VPS)
docker cp dispatch-railway.dump <conteneur-postgres>:/tmp/
docker exec -it <conteneur-postgres> pg_restore --no-owner --no-acl -U postgres -d postgres /tmp/dispatch-railway.dump
```

Puis redéployer l'application : au démarrage, `server/migrate.ts` détecte la base héritée, l'aligne sur le nouveau schéma (`migrations/legacy-baseline.sql`) sans perte de données, et applique les migrations suivantes. Ce chemin a été testé sur une reproduction de l'ancien schéma.

Si `pg_restore` échoue sur `type "vector" does not exist`, supprimer la colonne inutilisée côté Railway avant de refaire le dump : `ALTER TABLE bullets DROP COLUMN IF EXISTS embedding;`. Le code ne l'a jamais remplie.

Si la base Railway n'existe plus : se créer un compte sur la nouvelle instance, puis réimporter la bibliothèque via « Importer un CV » ou l'export JSON (Paramètres → Exporter) si tu en as un.

## 5. Vérifications après déploiement

```bash
curl -fsS https://cv.mondomaine.fr/healthz      # {"ok":true}
```

- Connexion, création d'une expérience, génération d'un CV complet.
- Coolify → Logs : aucune donnée de CV ni email dans les journaux (seulement méthode, chemin, statut, durée).
- Une sauvegarde planifiée a tourné et apparaît dans le bucket.

## 6. Entretien

- Mises à jour de Coolify : automatiques (Settings → Auto Update).
- Mensuel : `docker system prune -af --filter "until=720h"` pour libérer le disque.
- Trimestriel : restaurer une sauvegarde sur une base temporaire.
- À chaque départ d'un utilisateur ou fuite suspectée : changer `SESSION_SECRET` (déconnecte tout le monde) et la clé LLM.

## 7. Développement local

```bash
cp .env.example .env            # puis remplir
npm install
npm run db:migrate              # crée le schéma
npm run dev
```

Modifier le schéma : éditer `shared/schema.ts`, puis `npm run db:generate -- --name <nom>` et committer le fichier SQL généré. Ne jamais utiliser `drizzle-kit push` sur une base de production.
