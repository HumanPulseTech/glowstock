-- Dedicated NEW database only. Never apply to the GlowStock database.
-- Use a migration account; runtime needs SELECT/INSERT/UPDATE on caisse_state,
-- SELECT/INSERT on caisse_events, SELECT/INSERT/DELETE on caisse_nonces.
CREATE TABLE caisse_state (
 tenant_id VARCHAR(16) NOT NULL PRIMARY KEY,
 data LONGTEXT NOT NULL CHECK (JSON_VALID(data)),
 sequence_no BIGINT UNSIGNED NOT NULL DEFAULT 0,
 last_mac CHAR(64) NOT NULL DEFAULT ''
) ENGINE=InnoDB;
CREATE TABLE caisse_events (
 tenant_id VARCHAR(16) NOT NULL,
 sequence_no BIGINT UNSIGNED NOT NULL,
 actor_id VARCHAR(16) NOT NULL,
 occurred_at VARCHAR(30) NOT NULL,
 payload LONGTEXT NOT NULL CHECK (JSON_VALID(payload)),
 previous_mac CHAR(64) NOT NULL,
 mac CHAR(64) NOT NULL,
 PRIMARY KEY (tenant_id, sequence_no)
) ENGINE=InnoDB;
CREATE TABLE caisse_nonces (
 nonce CHAR(36) NOT NULL PRIMARY KEY,
 expires_at BIGINT UNSIGNED NOT NULL,
 INDEX (expires_at)
) ENGINE=InnoDB;
