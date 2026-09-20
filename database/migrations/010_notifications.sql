-- Centre de notifications GlowStock.
-- Cette migration est également initialisée automatiquement par l'application
-- au premier chargement des notifications.

CREATE TABLE IF NOT EXISTS notifications (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id INT(11) NOT NULL,
  created_by_user_id INT(11) NULL,
  type VARCHAR(32) NOT NULL,
  title VARCHAR(160) NOT NULL,
  message TEXT NOT NULL,
  link VARCHAR(255) NULL,
  dedupe_key VARCHAR(191) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  dismissed_at DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_notifications_user_dedupe (user_id, dedupe_key),
  KEY idx_notifications_user_active (user_id, dismissed_at, created_at),
  KEY idx_notifications_author (created_by_user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
