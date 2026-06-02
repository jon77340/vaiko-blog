# Vaïko — Carnet de séjour

Blog statique magazine pour partager le quotidien de **Vaïko** depuis l'iPhone, via **Telegram**.

---

## Architecture

```
       iPhone
         │
         │  photo / vidéo / texte
         ▼
   Canal Telegram privé "Vaïko"
         │
         │  toutes les 5 min, le Worker pull les nouveaux posts
         ▼
   Cloudflare Worker  (vaiko-sync)
         │
         │  télécharge les médias, met à jour les JSON
         ▼
   Cloudflare R2  (bucket "vaiko")
         │
         │  ← le site lit en direct
         ▼
   Cloudflare Pages  (vaiko.bianchi.biz)
         │
         ▼
       Norvège  (CDN Cloudflare proche)
```

**Pipeline complet, zéro intervention manuelle**. Tu postes sur Telegram depuis l'iPhone, le site est à jour en 5 min max.

---

## Structure du dépôt

```
.
├── index.html                  ← page unique
├── styles.css                  ← design magazine épuré
├── app.js                      ← logique front (lecture des JSON)
├── sw.js                       ← service worker (cache offline)
├── content/
│   ├── posts.json              ← fallback statique (le Worker remplace dynamiquement)
│   ├── gallery.json            ← fallback statique
│   └── walks.json              ← édité à la main (lieux de balades)
├── functions/
│   ├── content/[file].js       ← Pages Function : sert les JSON depuis R2
│   └── media/[file].js         ← Pages Function : sert photos/vidéos depuis R2
└── worker/
    ├── src/index.js            ← Worker Telegram → R2
    ├── wrangler.toml           ← config du Worker
    └── package.json
```

---

## Setup initial (30-45 min)

### 1. Créer le bot Telegram

1. Ouvre Telegram, cherche **@BotFather**, écris-lui `/newbot`
2. Donne un nom (`Vaïko Sync`) et un username (`vaiko_sync_bot` par exemple)
3. **Copie le token** qu'il te donne (format `123456:ABC-DEF...`) — ne le partage jamais

### 2. Créer le canal Telegram privé

1. Telegram → menu → **Nouveau canal**
2. Nom : `Vaïko Journal` (ou ce que tu veux)
3. Confidentialité : **Privé**
4. Ajoute le bot comme **administrateur** du canal (clé : il faut qu'il puisse lire les messages)
5. Envoie un premier message test dans le canal

### 3. Récupérer l'ID du canal

Depuis ton navigateur, va sur :
```
https://api.telegram.org/bot<TON_TOKEN>/getUpdates
```
Tu verras un JSON avec ton message test. Note la valeur `chat.id` — c'est un nombre négatif type `-1001234567890`. C'est ton `CHANNEL_ID`.

### 4. Créer le bucket R2

Sur Cloudflare → **R2** → **Create bucket** → nom : `vaiko`. Plan gratuit, 10 Go inclus.

### 5. Déployer le Worker

```bash
cd worker
npm install
npx wrangler login                   # connexion à ton compte Cloudflare
npx wrangler secret put BOT_TOKEN    # colle ton token Telegram
npx wrangler secret put CHANNEL_ID   # colle l'ID du canal
npx wrangler secret put SYNC_TOKEN   # invente un mot de passe (pour /sync manuel)
npx wrangler deploy
```

Le Worker tourne maintenant toutes les 5 min en cron.

**Test manuel** : `https://vaiko-sync.<ton-subdomain>.workers.dev/sync?token=<SYNC_TOKEN>`

### 6. Déployer Pages

1. Push le repo sur GitHub
2. Cloudflare → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**
3. Sélectionne le repo `vaiko-blog`
4. Build : aucun, output `/`
5. Une fois déployé, va dans **Settings** → **Functions** → **R2 bucket bindings**
6. Ajoute : variable name = `MEDIA`, bucket = `vaiko`
7. Redéploie (commit vide ou bouton **Retry deployment**)

### 7. Attacher le custom domain

Pages → ton projet → **Custom domains** → ajoute `vaiko.bianchi.biz`. Cloudflare crée le CNAME automatiquement, HTTPS auto.

✅ **Site en ligne sur https://vaiko.bianchi.biz**

---

## Utilisation quotidienne

### Publier un post depuis l'iPhone

1. Ouvre le canal Telegram **Vaïko Journal**
2. Tape ton texte. Première ligne = **titre**. Lignes suivantes = **corps**.
3. Joins une photo ou une vidéo (ou plusieurs, en album)
4. Optionnel : ajoute `#balade` ou `#sieste` dans le texte pour taguer
5. **Envoie**.

→ Sous 5 minutes, c'est en ligne sur `vaiko.bianchi.biz`.

### Exemples de posts

**Post avec photo + texte** :
```
Jour 4 — la plage !
Première fois que je vois la mer. Les vagues m'ont surpris,
j'ai aboyé. Djanko s'est moqué.

#mer
```
+ photo jointe

**Photo seule (va dans la galerie)** :
```
Sieste sur le canapé
```
+ photo

**Vidéo** :
```
Course-poursuite avec Djanko

#jeux
```
+ vidéo

### Forcer une synchro immédiate

Si tu veux que ça apparaisse sans attendre les 5 min :
```
https://vaiko-sync.<ton-subdomain>.workers.dev/sync?token=<SYNC_TOKEN>
```
(à mettre en favori Safari iPhone pour un trigger one-tap)

---

## Optimisation Norvège (faible réseau)

Le site est conçu pour rester rapide même en zone à débit limité :

- **CDN Cloudflare global** → un serveur Cloudflare en Suède/Norvège répond directement
- **Service Worker** → une fois visité, le site marche **offline**
- **Images en lazy-loading natif** → chargées au scroll, pas toutes d'un coup
- **Vidéos en `preload=metadata`** → juste la miniature visible, lecture seulement au clic
- **Range requests** sur les vidéos → streaming progressif au lieu de download complet
- **Police chargée en `font-display: swap`** → texte visible immédiatement

Compression auto Telegram :
- Photos iPhone HEIC → JPEG ~250 KB (Telegram compresse à l'envoi)
- Vidéos 1080p → ~5-15 MB pour 30 sec (Telegram réencode)

---

## Personnaliser

- **Couleurs et typo** : `styles.css`, variables `:root` en haut
- **Tagline / hero** : `index.html`, balise `<header class="hero">`
- **Email de contact** : `index.html`, chercher `jonathan@bianchi.biz`
- **Balades** : éditer `content/walks.json` directement (on garde la main, pas via Telegram)

---

## Coûts

| Service | Plan | Coût |
|---|---|---|
| Cloudflare Pages | Free | 0 € |
| Cloudflare Workers | Free (100k req/jour) | 0 € |
| Cloudflare R2 | Free tier (10 GB stockage, 1M req/mois) | 0 € |
| Cloudflare DNS | Free | 0 € |
| Telegram | Free | 0 € |
| Domaine bianchi.biz | (déjà payé chez Squarespace) | inchangé |

**Total mensuel : 0 €** pour ce projet.

---

## Dépannage

**Le site affiche des données vides**
→ Le Worker n'a pas encore tourné, ou le bucket R2 est vide. Force une synchro via `/sync?token=...`.

**Les médias ne s'affichent pas**
→ Vérifier que le binding R2 `MEDIA` est bien configuré sur **les deux** : Worker (`wrangler.toml`) **et** Pages (Settings → Functions → R2 bindings).

**"Unauthorized" sur /sync**
→ Le `SYNC_TOKEN` dans l'URL ne correspond pas au secret du Worker.

**Telegram retourne `getUpdates` vide**
→ Le bot doit être **administrateur** du canal, pas juste membre. Vérifier ses droits.

**Le Worker plante à la première synchro**
→ Vérifier les logs : `npx wrangler tail` dans le dossier `worker/`.

---

## Évolutions possibles

- **Modération** : un message contenant `[NOPUB]` est ignoré par le Worker (à coder)
- **Notif maîtres** : envoyer un mail aux maîtres dès qu'un nouveau post arrive
- **Stats** : compter les vues via Cloudflare Web Analytics (gratuit)
- **DMARC** : après le voyage, ajouter un record DMARC sur Cloudflare DNS

---

*Bon séjour Vaïko. Bon voyage en Norvège aux humains.*
