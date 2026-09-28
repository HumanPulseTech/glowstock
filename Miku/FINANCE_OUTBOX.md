# Human Pulse Finance — outbox GlowStock

Cette intégration concerne exclusivement les recettes et remboursements de **Human Pulse Tech** issus des abonnements GlowStock Stripe. Elle ne doit jamais être importée par le module ou le serveur Caisse.

## Déploiement

1. Appliquer `database/migrations/023_human_pulse_finance_outbox.sql` dans la base **GlowStock** uniquement.
2. Créer un client de service `glowstock` dans Human Pulse Finance avec les droits `revenue:create` et `refund:create`.
3. Ajouter, dans les variables Dokploy du serveur principal GlowStock :

```env
FINANCE_OUTBOX_ENABLED=true
HUMAN_PULSE_FINANCE_URL=https://humanpulsetech.fr
HUMAN_PULSE_FINANCE_API_KEY=hpf_...
```

Ne jamais placer ces variables dans l'application Caisse, son service Node, sa base, le navigateur ou Git.

## Flux

- `invoice.paid` Stripe avec un montant réellement encaissé crée, dans la même transaction que l'état d'abonnement, une ligne `revenue` dans `finance_outbox`.
- `refund.created` Stripe relié à une facture GlowStock crée une ligne `refund` séparée.
- Le worker du serveur principal tente l’envoi toutes les dix secondes. Les échecs réseau, 429 et 5xx sont rejoués avec la même clé d'idempotence ; les 400, 401, 403 et 409 sont mis en erreur pour contrôle humain.
- L'endpoint administrateur `GET /api/finance/outbox-status` donne les statuts, sous l'autorisation `manage_subscriptions`.

Un événement envoyé est identifié de façon stable, par exemple `glowstock:invoice:in_…`. La clé d'idempotence HTTP est cet identifiant exact.
