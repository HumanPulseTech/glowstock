# Revue sécurité et préparation d'audit — Caisse

Date : 27 septembre 2026. Portée : code du service Caisse, son pont GlowStock et le navigateur. Cette revue n'est ni une certification NF525, ni un test d'intrusion de l'infrastructure Dokploy.

## Contrôles présents et vérifiés par tests

| Risque | Mesure présente | État |
| --- | --- | --- |
| Un navigateur se donne un autre compte ou un autre rôle | GlowStock reconstruit l'identité depuis la session ; le service ne reçoit qu'un contexte signé | Couvert par les tests du bridge |
| Rejeu ou modification d'une requête vers Caisse | Signature HMAC liée au chemin, corps, compte, acteur et date ; nonce à usage unique de 60 secondes | Couvert par les tests HTTP |
| Écrasement d'un ticket par deux onglets | Verrou SQL par compte et numéro de version optimiste | Couvert par les tests métier et transactionnels |
| Modification silencieuse d'une validation ou d'une clôture | Événements chaînés HMAC ; empreinte liée au ticket simulé, à son annulation et à la clôture ; vérificateur disponible | Couvert par les tests de chaîne et de stockage |
| Injection de montants ou TVA mal formés | Entiers en centimes, bornes, validation explicite de TVA et prix non défini bloquant | Couvert par les tests métier |
| Données carte conservées localement | Aucun numéro, cryptogramme ou piste de carte n'est accepté ; seule une référence TPE optionnelle est possible | Contrôle de conception |
| Fuite de contexte à un autre compte | Requêtes produits/rendez-vous filtrées côté GlowStock avant signature | Couvert par les tests du bridge |

## Écarts à fermer avant une caisse de production

1. **Ancrage externe : bloquant.** Le HMAC détecte les incohérences tant que la clé et la base ne sont pas toutes deux compromises. Il faut envoyer régulièrement la tête du journal et les rapports scellés vers une archive à accès séparé, puis tester la restauration.
2. **Clés : bloquant.** `CAISSE_AUDIT_KEY` doit vivre hors du dépôt et hors de GlowStock. Prévoir un coffre de secrets, une procédure de rotation qui conserve les clés historiques, et un accès limité.
3. **Base de données : bloquant.** Compte Caisse à privilèges minimaux, TLS avec CA vérifiée hors réseau privé, pas d'exposition publique MariaDB, sauvegardes chiffrées et testées.
4. **Encaissement réel : bloquant.** Paiement fractionné, réponse incertaine du TPE, remboursements, avoirs et rapprochement ne sont pas encore implémentés.
5. **Stock : bloquant.** Le pilote vérifie le stock mais ne le modifie pas. Une sortie réelle doit être livrée de façon durable et idempotente à GlowStock.
6. **Rôles : bloquant.** Le pilote utilise l'accès administrateur existant. Les profils caissière, responsable, approbateur et les traces d'actions sensibles restent à définir.
7. **Infrastructure : bloquant.** Ajouter limitation de débit aux bords exposés, supervision, alertes d'échec de sauvegarde, journalisation centralisée et procédure d'incident.

## Vérification à chaque déploiement pilote

1. Les deux bases sont différentes et Caisse n'a aucun identifiant de la base GlowStock.
2. Les secrets de liaison et d'audit sont distincts, aléatoires, et n'apparaissent ni dans Git ni dans les journaux.
3. `CAISSE_MODE=simulation` reste inchangé ; toute tentative de `checkout` répond 501.
4. L'ouverture, une simulation, une annulation, une fermeture, puis « Vérifier l'intégrité du journal » passent correctement.
5. Une sauvegarde de la base Caisse est restaurée dans un environnement isolé et l'intégrité y est vérifiée.

## Position NF525

Les fonctions développées ici préparent notamment l'inaltérabilité technique : documents figés, corrections additives, ordre d'écritures et contrôle d'intégrité. Elles ne suffisent pas à établir les exigences complètes de sécurisation, conservation et archivage, ni les exigences documentaires et opérationnelles. Toute attestation ou communication de conformité doit attendre la matrice officielle applicable, une recette complète et un avis compétent.
