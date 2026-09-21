# GlowStock Caisse — pilote 0.1.0

**Simulation uniquement. Aucun encaissement réel, aucune valeur fiscale, aucune certification NF525 revendiquée.**

## Ce qui fonctionne

Catalogue de produits et prestations, recherche, filtres, ticket associé au rendez-vous du jour, ajout et modification des lignes, prix et TVA explicitement choisis, simulation carte/espèces/autre, rendu de monnaie, ticket figé après simulation. En cas de rendez-vous ambigu, choix manuel plutôt qu'ouverture arbitraire. La connexion redirige vers la caisse uniquement lorsque le pilote est activé et le compte autorisé.

Les prix de vente n'existent pas dans l'inventaire actuel : ils se définissent dans ce catalogue. Une prestation du planning ne reçoit un prix automatiquement que si son nom correspond exactement à un tarif unique. Sinon, la validation est bloquée jusqu'à confirmation du prix et de la TVA. Modifier un prix dans le ticket ne modifie pas le catalogue.

## Architecture retenue

Un serveur physique peut héberger deux applications déployables indépendamment :

- GlowStock : interface, connexion, permissions, lecture de son planning et de ses produits.
- Service Caisse : calculs, brouillons, simulations et journal technique, avec sa base dédiée.

Le navigateur appelle uniquement GlowStock. GlowStock transmet une requête signée au service Caisse. L'identité du compte est reconstruite depuis la session, jamais depuis les données du navigateur. Le service n'a pas les identifiants de la base GlowStock. Les appels signés expirent et leur rejeu est rejeté.

Cette séparation réduit le couplage des déploiements, mais ne rend pas le serveur physique redondant : sa panne arrête les deux applications. Les sauvegardes doivent être hors de ce serveur.

Le modèle pilote suit le modèle existant : **un compte utilisateur = son planning et son stock**. Un institut partagé entre plusieurs salariées, avec rôles de caissière/responsable et sessions de caisse, n'est pas implémenté. L'accès pilote est réservé aux administrateurs : il nécessite `access_admin`, `manage_products` et un abonnement de niveau `full`. Ces droits sont relus côté serveur sur chaque accès à la page et à l'API ; le menu et la redirection de connexion utilisent le même contrôle. Un rôle annoncé par le navigateur ou conservé dans une ancienne session ne suffit pas. Tous les comptes possédant ces droits sont administrateurs au sens de ce contrôle.

## Essayer sans toucher à la production

Depuis la racine du dépôt, avec Node 22 :

```powershell
npm ci --prefix services/caisse --ignore-scripts
node services/caisse/test/demo-server.js
```

Ouvrir `http://127.0.0.1:8095/dashboard/caisse/`. La démonstration utilise uniquement des données fictives en mémoire et ne charge aucun fichier `.env`. Tout disparaît lorsqu'on arrête ce processus. Aucun compte réel n'est nécessaire. L'accès est limité à la machine locale.

Tests métier/API : `npm test --prefix services/caisse`. Tests du site existant : `npm test` à la racine. Le test navigateur facultatif `test/browser-check.js` demande Playwright et Edge, via `PLAYWRIGHT_MODULE` si nécessaire. Les captures locales ne sont pas versionnées.

## Déploiement pilote dans Dokploy — à préparer, non exécuté

1. Préférer un environnement de test séparé. L'envoi du pilote sur `main` a été autorisé le 21 septembre 2026, avec accès administrateur uniquement ; cette branche déclenche actuellement la production. L'envoi du code seul ne crée ni le service Caisse ni sa base. Garder `CAISSE_ENABLED=false` jusqu'à leur configuration et leur vérification.
2. Créer une **nouvelle base dédiée** et un utilisateur propre au service. Ne pas réutiliser le compte administrateur ou le compte de la base GlowStock.
3. Exécuter `migrations/001_pilot.sql` une seule fois dans cette nouvelle base, avec un compte de migration. Ce fichier n'altère aucune table GlowStock et n'a pas été appliqué ici.
4. Donner au compte d'exécution uniquement : SELECT/INSERT/UPDATE sur `caisse_state`, SELECT/INSERT sur `caisse_events`, SELECT/INSERT/DELETE sur `caisse_nonces`. Pas de DROP/ALTER ni UPDATE/DELETE sur le journal. Le compte de migration ne doit pas être fourni à l'application.
5. Créer une seconde application Dokploy à partir du dépôt. Dockerfile `services/caisse/Dockerfile`, contexte de construction `services/caisse`, port interne 8090. L'image utilise Node 22. Ne pas publier directement ce port sur Internet.
6. Renseigner les variables de `services/caisse/.env.example` dans Dokploy. Générer deux secrets aléatoires indépendants d'au moins 48 caractères : clé de liaison et clé du journal. Ne jamais les committer ni les envoyer dans une conversation. La clé du journal reste uniquement côté Caisse. Prévoir sa sauvegarde sécurisée ; la rotation avec conservation historique reste à implémenter.
7. Côté GlowStock de test : `CAISSE_SERVICE_URL` vers l'origine du service, `CAISSE_BRIDGE_SECRET` identique à la clé de liaison et `CAISSE_ENABLED=true`. Aucun sous-chemin dans l'URL. Conserver les dossiers `integrations` et `services/caisse/src/signing.js` dans le déploiement principal.
8. Préférer HTTPS avec certificat validé. `CAISSE_ALLOW_PRIVATE_HTTP=true` n'est qu'une exception pour un réseau interne de test réellement isolé ; ne pas l'utiliser pour traverser Internet. La signature ne chiffre pas les noms des clientes. Protéger aussi la liaison SQL : CA validée via `CAISSE_DB_CA_FILE` hors réseau privé maîtrisé. Ne pas exposer MariaDB.
9. Synchroniser les horloges des deux services ; un décalage supérieur à 30 secondes empêche les appels. Vérifier les droits, les connexions et les restaurations sur cette infrastructure avant ouverture du pilote.

`GET /health` vérifie uniquement que le processus répond, pas que la base fonctionne. Une lecture de l'espace caisse par un compte de test autorisé doit compléter la vérification de déploiement. La migration réelle, l'image Docker et le fonctionnement MariaDB n'ont pas été validés dans l'environnement local actuel.

Pour désactiver : `CAISSE_ENABLED=false` côté GlowStock et redéployer cette configuration. Conserver la base ; ne pas supprimer ses tables pour désactiver l'interface. Une panne de caisse ne doit pas empêcher la connexion au tableau de bord.

## Limites et sécurité du pilote

- Aucun débit du stock, connexion TPE, paiement Stripe, facture, reçu fiscal, avoir, remboursement, remise, clôture, archive fiscale ou mode hors ligne.
- Limites par compte : 500 tarifs, 100 tickets conservés, 100 lignes par ticket, 100 unités par ligne. Source : 1 000 produits et 200 rendez-vous maximum par jour. Pas de purge automatique ni d'administration du catalogue existant.
- Les écritures SQL du brouillon et de son événement utilisent une même transaction, avec verrou par compte et contrôle de version. Les tests de transaction utilisent un double de base ; une véritable recette MariaDB avec concurrence et interruption reste nécessaire.
- La simulation possède une clé d'idempotence : réessayer la même validation ne la duplique pas. Après perte réseau, l'interface relit l'état avant de continuer. Le stock lu n'est ni réservé ni garanti : la validation réelle devra gérer les écritures interservices et les reprises, pas simplement déduire ce stock après coup.
- Le journal est chaîné par HMAC. Le vérificateur `src/verify-events.js` détecte certaines altérations et une suppression finale **si une tête de chaîne externe fiable lui est fournie**. L'ancrage externe n'est pas implémenté. Un administrateur qui contrôle la base et les clés peut réécrire les données ; ce mécanisme ne constitue pas une preuve de conformité.
- Les captures de démo sont fictives. Les bases pilotes connectées à de vrais comptes contiennent des noms de clientes : limiter les accès et définir la conservation avant tout essai réel.

Voir [la feuille de route fiscale](READINESS.md) avant toute évolution vers les encaissements réels.
