-- SIRET et dénomination de l'entreprise sélectionnée lors de l'inscription.
-- La migration est aussi initialisée automatiquement à la première inscription.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS siret VARCHAR(14) NULL AFTER nom,
  ADD COLUMN IF NOT EXISTS company_name VARCHAR(255) NULL AFTER siret;

CREATE INDEX IF NOT EXISTS idx_users_siret ON users (siret);
