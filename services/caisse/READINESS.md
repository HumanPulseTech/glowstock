# Préparation fiscale — état réel du pilote

Date : 21 septembre 2026. Version : 0.1.0 simulation. **Conformité non démontrée / non certifié / non utilisable pour enregistrer les règlements réels.**

Ce document est une liste d'écarts techniques, pas un audit exhaustif du référentiel NF525. Le référentiel officiel complet et sa version applicable doivent être obtenus avant de construire une matrice exigence par exigence. Aucun identifiant d'exigence NF525 n'est inventé ici.

La démarche AFNOR inclut un audit ; la validation n'est pas garantie par le dépôt d'un dossier. Sources consultées : [AFNOR, certification Logiciel de gestion d'encaissement](https://certification.afnor.org/numerique/nf-logiciel-de-gestion-d-encaissement), [INFOCERT, NF525](https://infocert.org/nf525/). La validité d'une éventuelle attestation éditeur doit être vérifiée séparément au regard du droit applicable au moment de la mise en service.

| Sujet | Présent dans le pilote | Travail bloquant avant usage fiscal |
| --- | --- | --- |
| Périmètre | Service et base séparés | Établissements, sociétés, acteurs et responsabilités ; version officielle du référentiel |
| Calculs | Centimes, arrondi TVA par ligne, taux explicite | Règles validées, ventilation par taux, remises, acomptes, arrondis, cas limites |
| Intégrité | Ticket simulé figé, version, transaction SQL, HMAC | Modèle fiscal immuable, ancrage indépendant, vérification à l'exploitation, gestion et rotation des clés |
| Traçabilité | Acteur, séquence et instant des événements métier | Journal fiscal complet incluant incidents, opérations sensibles et changements de configuration ; politique horloge |
| Paiements | Simulations carte/espèces/autre | Sessions de caisse, encaissements réels, paiements fractionnés, annulations, avoirs, remboursements, preuves et rapprochement |
| Stock | Lecture et vérification indicative, sans écriture | Réservation/concurrence, mécanisme de livraison durable des mouvements, reprise et déduplication interservices |
| Conservation | Base dédiée | Durées applicables, sauvegardes indépendantes, restauration testée, contrôle d'intégrité et protection des accès |
| Clôtures et archives | Absent | Clôtures, totalisateurs, archives sécurisées, exports de contrôle et outils de lecture indépendants |
| Exploitation | Docker Node 22, arrêt propre, secrets externes | Recette MariaDB réelle, tests de charge/panne/reprise, surveillance, procédures incident et mises à jour maîtrisées |
| Dossier et qualité | Sources et tests automatisés | Matrice officielle complète, preuves versionnées, procédures éditeur, documentation utilisateur et audit du périmètre |

## Ordre de passage à une version exploitable

1. Faire valider l'ergonomie avec des données fictives et confirmer le modèle utilisateur/institut, les prestations et les régimes de TVA.
2. Obtenir les règles officielles applicables et arrêter le périmètre avec l'organisme compétent. Transformer chaque exigence en critère vérifiable, preuve et test.
3. Implémenter les éléments manquants ci-dessus, sans transformer une simulation historique en vente réelle. Prévoir des espaces de test et de production distincts.
4. Recetter sur l'infrastructure cible : transactions, accès croisés, interruptions, tentatives de modification, sauvegarde/restauration et archives. Faire revoir les risques résiduels indépendamment.
5. Constituer le dossier et suivre le processus d'évaluation choisi. Ne publier aucune allégation NF525 sans base vérifiée et autorisation applicable.

Le module ne dispose d'aucun interrupteur permettant un encaissement réel : `CAISSE_MODE` doit rester `simulation`, et l'opération `checkout` retourne 501. L'ouverture réelle demandera une nouvelle version et une décision explicite, pas une simple variable d'environnement.
