-- Trace minimale de l'information légale acceptée lors de la création du compte.
-- À appliquer avant de déployer la nouvelle inscription.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS terms_accepted_at DATETIME NULL AFTER email_verified,
  ADD COLUMN IF NOT EXISTS privacy_acknowledged_at DATETIME NULL AFTER terms_accepted_at,
  ADD COLUMN IF NOT EXISTS legal_version VARCHAR(20) NULL AFTER privacy_acknowledged_at;
