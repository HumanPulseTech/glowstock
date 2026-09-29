-- Base GlowStock : registres append-only pour fidélité et cartes cadeaux.
CREATE TABLE IF NOT EXISTS loyalty_settings (
 id_user INT NOT NULL PRIMARY KEY,
 is_enabled TINYINT(1) NOT NULL DEFAULT 0,
 points_per_euro INT UNSIGNED NOT NULL DEFAULT 1,
 reward_points INT UNSIGNED NOT NULL DEFAULT 100,
 reward_cents INT UNSIGNED NOT NULL DEFAULT 500,
 expires_after_days SMALLINT UNSIGNED NULL,
 updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 CONSTRAINT loyalty_settings_user FOREIGN KEY (id_user) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE IF NOT EXISTS loyalty_accounts (
 customer_id INT NOT NULL PRIMARY KEY,
 id_user INT NOT NULL,
 balance_points INT NOT NULL DEFAULT 0,
 updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 CONSTRAINT loyalty_accounts_customer FOREIGN KEY (customer_id) REFERENCES crm_customers(id) ON DELETE CASCADE,
 INDEX loyalty_accounts_owner (id_user, customer_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE IF NOT EXISTS loyalty_ledger (
 id CHAR(36) NOT NULL PRIMARY KEY,
 id_user INT NOT NULL,
 customer_id INT NOT NULL,
 operation_key CHAR(64) NOT NULL,
 operation_type VARCHAR(40) NOT NULL,
 points_delta INT NOT NULL,
 balance_after INT NOT NULL,
 reason VARCHAR(500) NOT NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE KEY loyalty_ledger_operation (id_user, operation_key),
 CONSTRAINT loyalty_ledger_customer FOREIGN KEY (customer_id) REFERENCES crm_customers(id) ON DELETE RESTRICT,
 INDEX loyalty_ledger_history (id_user, customer_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE IF NOT EXISTS gift_cards (
 id CHAR(36) NOT NULL PRIMARY KEY,
 id_user INT NOT NULL,
 code VARCHAR(40) NOT NULL,
 initial_cents INT UNSIGNED NOT NULL,
 balance_cents INT UNSIGNED NOT NULL,
 expires_at DATE NULL,
 status ENUM('active','disabled','expired') NOT NULL DEFAULT 'active',
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE KEY gift_cards_code (code),
 INDEX gift_cards_owner (id_user, status),
 CONSTRAINT gift_cards_user FOREIGN KEY (id_user) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE IF NOT EXISTS gift_card_ledger (
 id CHAR(36) NOT NULL PRIMARY KEY,
 id_user INT NOT NULL,
 gift_card_id CHAR(36) NOT NULL,
 operation_key CHAR(64) NOT NULL,
 operation_type VARCHAR(40) NOT NULL,
 amount_delta_cents INT NOT NULL,
 balance_after_cents INT UNSIGNED NOT NULL,
 reason VARCHAR(500) NOT NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE KEY gift_card_ledger_operation (id_user, operation_key),
 CONSTRAINT gift_card_ledger_card FOREIGN KEY (gift_card_id) REFERENCES gift_cards(id) ON DELETE RESTRICT,
 INDEX gift_card_ledger_history (id_user, gift_card_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
