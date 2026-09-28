-- Base GlowStock uniquement. Ne jamais appliquer à la base du service Caisse.
-- Cette outbox contient exclusivement les recettes/remboursements de Human Pulse Tech.
CREATE TABLE IF NOT EXISTS finance_outbox (
 event_id VARCHAR(191) NOT NULL PRIMARY KEY,
 event_type VARCHAR(40) NOT NULL,
 source_reference VARCHAR(255) NOT NULL,
 origin_event_id VARCHAR(191) NULL,
 payload LONGTEXT NOT NULL CHECK (JSON_VALID(payload)),
 status VARCHAR(20) NOT NULL DEFAULT 'pending',
 attempt_count INT UNSIGNED NOT NULL DEFAULT 0,
 next_attempt_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 locked_until DATETIME NULL,
 lease_token CHAR(36) NULL,
 finance_entry_id VARCHAR(100) NULL,
 last_error VARCHAR(1000) NULL,
 sent_at DATETIME NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 UNIQUE KEY finance_outbox_source (event_type, source_reference),
 KEY finance_outbox_ready (status, next_attempt_at, locked_until),
 KEY finance_outbox_origin (origin_event_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
