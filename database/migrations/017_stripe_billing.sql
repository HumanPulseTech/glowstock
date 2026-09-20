-- Stripe : abonnements, portail client, événements signés et avoirs.
-- À exécuter avant d'activer les clés Stripe en production.

ALTER TABLE marketing_offers
  ADD COLUMN IF NOT EXISTS stripe_price_id VARCHAR(255) NULL AFTER included_access;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS pending_offer_id BIGINT UNSIGNED NULL AFTER subscription_credit;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS stripe_customer_id VARCHAR(255) NULL AFTER pending_offer_id;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS stripe_subscription_id VARCHAR(255) NULL AFTER stripe_customer_id;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS stripe_subscription_status VARCHAR(50) NULL AFTER stripe_subscription_id;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS stripe_price_id VARCHAR(255) NULL AFTER stripe_subscription_status;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS stripe_current_period_end DATETIME NULL AFTER stripe_price_id;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS stripe_synced_credit DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER stripe_current_period_end;

CREATE TABLE IF NOT EXISTS stripe_webhook_events (
  event_id VARCHAR(255) NOT NULL,
  event_type VARCHAR(100) NOT NULL,
  received_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (event_id),
  KEY idx_stripe_webhook_events_received (received_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
