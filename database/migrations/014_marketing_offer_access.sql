-- Fonctionnalités incluses dans chaque offre commerciale.

ALTER TABLE marketing_offers
  ADD COLUMN IF NOT EXISTS included_access TEXT NULL AFTER features;
