-- Montant personnalisé par abonnement, utilisé pour l'alerte de prélèvement.
-- Laisser le montant vide désactive cette alerte pour le compte concerné.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS subscription_amount DECIMAL(10,2) NULL AFTER date_abo;
