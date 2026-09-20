-- Enregistre une demande d'annulation à la fin de la période en cours.
-- L'abonnement reste actif jusqu'à users.date_abo.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS abo_cancel_requested_at DATETIME NULL AFTER date_abo;

CREATE INDEX IF NOT EXISTS idx_users_abo_cancel_requested
  ON users (abo_cancel_requested_at);
