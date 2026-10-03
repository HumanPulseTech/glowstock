-- BASE GLOWSTOCK UNIQUEMENT (pas la base du service Caisse).
-- Après 027. Migration additive et réexécutable sur MariaDB.
-- Les anciennes cartes restent consultables et portent la nature "legacy".
CREATE TABLE IF NOT EXISTS gift_card_registers (
 id_user INT NOT NULL PRIMARY KEY,
 next_entry BIGINT UNSIGNED NOT NULL DEFAULT 1,
 CONSTRAINT gift_card_registers_user FOREIGN KEY (id_user) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

ALTER TABLE gift_cards
 ADD COLUMN IF NOT EXISTS issue_kind ENUM('legacy','gift','external_sale') NOT NULL DEFAULT 'legacy',
 ADD COLUMN IF NOT EXISTS tax_treatment ENUM('unspecified','single_purpose','multi_purpose') NOT NULL DEFAULT 'unspecified',
 ADD COLUMN IF NOT EXISTS reference VARCHAR(100) NOT NULL DEFAULT '';

ALTER TABLE gift_card_ledger
 ADD COLUMN IF NOT EXISTS entry_no BIGINT UNSIGNED NULL,
 ADD COLUMN IF NOT EXISTS request_hash CHAR(64) NULL,
 ADD COLUMN IF NOT EXISTS reference VARCHAR(100) NOT NULL DEFAULT '',
 ADD COLUMN IF NOT EXISTS reversal_of CHAR(36) NULL,
 ADD COLUMN IF NOT EXISTS source_key CHAR(64) NULL,
 ADD UNIQUE INDEX IF NOT EXISTS gift_card_ledger_sequence (id_user,entry_no),
 ADD UNIQUE INDEX IF NOT EXISTS gift_card_ledger_source (id_user,source_key),
 ADD INDEX IF NOT EXISTS gift_card_ledger_reversal (id_user,gift_card_id,reversal_of);
