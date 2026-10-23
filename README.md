# Pré-commandes L'ELEFAN

Boutique de pré-commandes pour l'éléfàn : catalogue, commandes et suivi des ventes dans une base SQLite (prototypage initial, à connecter à l'espace membres à terme),
HelloAsso (sandbox) utilisé uniquement comme moyen de paiement (Checkout API).

## Lancer en local

```bash
npm start            # https://localhost:8443 (certificat auto-signé : HelloAsso exige une adresse de retour en https)
npm run demo         # ajoute ~45 commandes de démonstration (npm run demo -- --reset : repart d'une base vide)
```

Node 22.5 ou plus récent (module `node:sqlite`), aucune dépendance npm.
Les clés de l'API HelloAsso (sandbox) se donnent par variables d'environnement, par exemple :

```bash
HELLOASSO_CLIENT_ID=… HELLOASSO_CLIENT_SECRET=… npm start
```

## Réglages (variables d'environnement)

| Variable | Rôle |
| --- | --- |
| `PORT`, `HOST` | port et adresse d'écoute (8443, 127.0.0.1) |
| `BASE_URL` | adresse publique, éventuellement avec un préfixe |
| `PLAIN_HTTP=1` | http simple derrière un proxy qui fait déjà le TLS |
| `ADMIN_PASSWORD` | mot de passe de l'administration |
| `DB_FILE`, `UPLOAD_DIR` | base SQLite et dossier des images téléversées |
| `HELLOASSO_CLIENT_ID`, `HELLOASSO_CLIENT_SECRET` | clés de l'API HelloAsso |
| `HELLOASSO_API`, `HELLOASSO_ORG` | adresse de l'API (sandbox par défaut) et organisation (`l-elefan`) |

## Fonctionnement

- Une **campagne** a ses **produits**, ses **commandes**, ses **dates de livraison** et un **délai maximum de commande** (jours avant la
  livraison). Une boutique prend des commandes pour la prochaine livraison ; sans livraison à venir, ou si elle est plus proche
  que le délai, elle reste visible mais fermée. Un **seuil minimum** (poids ou montant) ajoute sur la boutique une mention "sous réserve d'atteindre notre
  seuil de … " tant que les commandes payées pour cette livraison ne l'atteignent pas.
- Un prix peut avoir un **nom** (ex. "x2") affiché sur la boutique à la place du poids ; le poids sert toujours aux totaux.
- Adresses : `/` et `/precommandes` (liste des campagnes ouvertes au public), `/boutique/<adresse>`, `/admin` (campagnes), `/admin/commandes`, `/admin/produits`, exports CSV.

## Structure

```
src/
  server.js       démarrage (https ou http) et aiguillage des adresses
  config.js       réglages (variables d'environnement) et chemins
  shop.js         pages publiques : campagnes, boutique, commande, retour de paiement
  admin.js        pages d'administration : campagnes, commandes, produits, exports, remboursements
  auth.js         mot de passe de l'administration (cookie signé)
  assets.js       fichiers statiques et images
  reports.js      requêtes de ventes et exports CSV
  orders.js       état d'une commande côté HelloAsso
  helloasso.js    client de l'API HelloAsso (paiement, remboursement)
  db.js, catalog.js, campaigns.js, weight.js, basepath.js, http.js
  views/          gabarits HTML : common (page, dates), shop (clients), admin
public/           feuille de style, scripts du navigateur, polices, photos des produits
scripts/          seed-demo.js (commandes de démonstration)
tests/            suites de tests
```

## Tests

```bash
npm install     # une fois : jsdom, utilisé par les tests du navigateur
npm test        # toutes les suites (order-ui, editor-ui, campagnes, connexion)
```

Chaque suite lance son propre serveur de test (ports 8444, 8448 et 8449) avec une base jetable dans `/tmp`. On peut aussi les lancer
une par une : `bash tests/run.sh order-ui.js`, `bash tests/run.sh editor-ui.js`, `bash tests/run-campaigns.sh`, `bash tests/run-auth.sh`.

## Docker

```bash
cp precommandes.env.example precommandes.env     # puis remplir BASE_URL, ADMIN_PASSWORD et les clés HelloAsso
docker compose up -d --build                      # http://127.0.0.1:4030 (HOST_PORT pour changer le port)
```

L'image (`Dockerfile`, basée sur `node:22-alpine`) ne contient que le code. Elle tourne avec
l'utilisateur `node`, en http simple (`PLAIN_HTTP=1`) pour qu'un proxy fasse le https, et expose une vérification de santé.
Les données (base SQLite et images téléversées) sont dans le volume `/data` : volume Docker `precommandes-data` par défaut, ou un
dossier existant (`DATA_DIR=/opt/precommandes/data`, créé avec `chown 1000:1000`). Mise à jour : `git pull` puis
`docker compose up -d --build`.
