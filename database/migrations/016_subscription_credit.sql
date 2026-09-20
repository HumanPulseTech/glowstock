-- Solde d'avoir utilisable en priorité lors des renouvellements.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS subscription_credit DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER subscription_amount;
