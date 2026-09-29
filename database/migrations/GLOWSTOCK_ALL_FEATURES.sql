-- GlowStock — installation réunie des modules livrés.
-- À exécuter UNE FOIS sur la base GlowStock (jamais sur la base Caisse).
-- Sauvegarde recommandée avant exécution. Script additif, sans DROP ni DELETE.

-- 1. Planning (requis pour rendez-vous et réservation publique)
CREATE TABLE IF NOT EXISTS planning_business_hours (
  id_user INT(11) NOT NULL, day_of_week TINYINT UNSIGNED NOT NULL,
  is_open TINYINT(1) NOT NULL DEFAULT 1, opens_at TIME NULL, closes_at TIME NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id_user, day_of_week),
  CONSTRAINT fk_planning_business_hours_user FOREIGN KEY (id_user) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE IF NOT EXISTS planning_entries (
  id INT(11) NOT NULL AUTO_INCREMENT, id_user INT(11) NOT NULL, appointment_date DATE NOT NULL,
  start_time TIME NOT NULL, end_time TIME NOT NULL, client_name VARCHAR(150) NOT NULL,
  service_name VARCHAR(150) NULL, notes VARCHAR(2000) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id), KEY idx_planning_entries_user_date_time (id_user, appointment_date, start_time),
  CONSTRAINT fk_planning_entries_user FOREIGN KEY (id_user) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- 2. Clientes, prestations et prix de vente
CREATE TABLE IF NOT EXISTS crm_customers (
 id INT NOT NULL AUTO_INCREMENT PRIMARY KEY, id_user INT NOT NULL, name VARCHAR(150) NOT NULL,
 email VARCHAR(254) NOT NULL DEFAULT '', phone VARCHAR(40) NOT NULL DEFAULT '', address VARCHAR(500) NOT NULL DEFAULT '', notes VARCHAR(2000) NOT NULL DEFAULT '',
 version INT NOT NULL DEFAULT 1, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, INDEX (id_user, name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS crm_services (
 id INT NOT NULL AUTO_INCREMENT PRIMARY KEY, id_user INT NOT NULL, name VARCHAR(150) NOT NULL,
 price_cents INT UNSIGNED NOT NULL, tax_mode VARCHAR(10) NOT NULL, tax_bps INT UNSIGNED NOT NULL,
 duration_minutes INT UNSIGNED NOT NULL DEFAULT 60, description VARCHAR(2000) NOT NULL DEFAULT '', version INT NOT NULL DEFAULT 1, INDEX (id_user, name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS crm_service_products (
 service_id INT NOT NULL, product_id INT NOT NULL, PRIMARY KEY (service_id, product_id),
 FOREIGN KEY (service_id) REFERENCES crm_services(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS crm_appointment_links (
 appointment_id INT NOT NULL PRIMARY KEY, id_user INT NOT NULL, customer_id INT NULL, service_id INT NULL,
 INDEX (id_user, customer_id), FOREIGN KEY (customer_id) REFERENCES crm_customers(id), FOREIGN KEY (service_id) REFERENCES crm_services(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS product_prices (
 product_id INT NOT NULL PRIMARY KEY, id_user INT NOT NULL, price_cents INT UNSIGNED NULL, INDEX (id_user)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 3. Import initial de stock (nécessite la table produits déjà présente)
ALTER TABLE produits ADD COLUMN IF NOT EXISTS fournisseur VARCHAR(150) NULL AFTER marque;
ALTER TABLE produits ADD COLUMN IF NOT EXISTS prix_achat_centimes INT UNSIGNED NULL AFTER fournisseur;
CREATE TABLE IF NOT EXISTS stock_imports (
 id CHAR(36) NOT NULL PRIMARY KEY, id_user INT NOT NULL, source_filename VARCHAR(255) NOT NULL, source_sha256 CHAR(64) NOT NULL, status VARCHAR(20) NOT NULL,
 raw_rows LONGTEXT NOT NULL CHECK (JSON_VALID(raw_rows)), mapping_json LONGTEXT NULL CHECK (mapping_json IS NULL OR JSON_VALID(mapping_json)), report_json LONGTEXT NULL CHECK (report_json IS NULL OR JSON_VALID(report_json)),
 committed_at DATETIME NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 KEY stock_imports_owner (id_user, created_at), CONSTRAINT stock_imports_user FOREIGN KEY (id_user) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE IF NOT EXISTS stock_movements (
 id CHAR(36) NOT NULL PRIMARY KEY, id_user INT NOT NULL, product_id INT NOT NULL, import_id CHAR(36) NULL, source_row INT NULL,
 movement_type VARCHAR(50) NOT NULL, quantity_delta INT NOT NULL, quantity_after INT NOT NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE KEY stock_movement_import_row (import_id, source_row), KEY stock_movements_product (id_user, product_id, created_at),
 CONSTRAINT stock_movements_user FOREIGN KEY (id_user) REFERENCES users(id) ON DELETE RESTRICT,
 CONSTRAINT stock_movements_product FOREIGN KEY (product_id) REFERENCES produits(id) ON DELETE RESTRICT,
 CONSTRAINT stock_movements_import FOREIGN KEY (import_id) REFERENCES stock_imports(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- 4. Fiches clientes enrichies
CREATE TABLE IF NOT EXISTS crm_customer_profiles (
 customer_id INT NOT NULL PRIMARY KEY, id_user INT NOT NULL, preferences TEXT NOT NULL, observations TEXT NOT NULL, version INT NOT NULL DEFAULT 1,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 CONSTRAINT crm_customer_profiles_customer FOREIGN KEY (customer_id) REFERENCES crm_customers(id) ON DELETE CASCADE, INDEX crm_customer_profiles_owner (id_user, customer_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE IF NOT EXISTS crm_customer_consents (
 id CHAR(36) NOT NULL PRIMARY KEY, id_user INT NOT NULL, customer_id INT NOT NULL, consent_type VARCHAR(100) NOT NULL, action ENUM('granted','revoked') NOT NULL,
 details VARCHAR(500) NULL, captured_by INT NOT NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT crm_customer_consents_customer FOREIGN KEY (customer_id) REFERENCES crm_customers(id) ON DELETE CASCADE, INDEX crm_customer_consents_history (id_user, customer_id, consent_type, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE IF NOT EXISTS crm_customer_media (
 id CHAR(36) NOT NULL PRIMARY KEY, id_user INT NOT NULL, customer_id INT NOT NULL, kind ENUM('before_after_photo','document') NOT NULL,
 filename VARCHAR(180) NOT NULL, mime_type VARCHAR(80) NOT NULL, byte_size INT UNSIGNED NOT NULL, sha256 CHAR(64) NOT NULL, blob_data MEDIUMBLOB NULL,
 created_by INT NOT NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, deleted_at DATETIME NULL,
 CONSTRAINT crm_customer_media_customer FOREIGN KEY (customer_id) REFERENCES crm_customers(id) ON DELETE CASCADE, INDEX crm_customer_media_owner (id_user, customer_id, deleted_at, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- 5. Réservation publique
CREATE TABLE IF NOT EXISTS booking_settings (
 id_user INT NOT NULL PRIMARY KEY, slug VARCHAR(80) NOT NULL UNIQUE, is_enabled TINYINT(1) NOT NULL DEFAULT 0,
 buffer_minutes SMALLINT UNSIGNED NOT NULL DEFAULT 0, cancellation_hours SMALLINT UNSIGNED NOT NULL DEFAULT 24,
 updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 CONSTRAINT booking_settings_user FOREIGN KEY (id_user) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE IF NOT EXISTS booking_closures (
 id CHAR(36) NOT NULL PRIMARY KEY, id_user INT NOT NULL, closure_date DATE NOT NULL, reason VARCHAR(150) NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE KEY booking_closure_day (id_user, closure_date), CONSTRAINT booking_closures_user FOREIGN KEY (id_user) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE IF NOT EXISTS booking_requests (
 id CHAR(36) NOT NULL PRIMARY KEY, id_user INT NOT NULL, appointment_id INT NOT NULL UNIQUE, customer_id INT NOT NULL, service_id INT NOT NULL,
 email VARCHAR(254) NOT NULL, cancellation_token_hash CHAR(64) NOT NULL UNIQUE, status ENUM('confirmed','cancelled') NOT NULL DEFAULT 'confirmed', created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, cancelled_at DATETIME NULL,
 CONSTRAINT booking_requests_user FOREIGN KEY (id_user) REFERENCES users(id) ON DELETE CASCADE, CONSTRAINT booking_requests_appointment FOREIGN KEY (appointment_id) REFERENCES planning_entries(id) ON DELETE RESTRICT,
 CONSTRAINT booking_requests_customer FOREIGN KEY (customer_id) REFERENCES crm_customers(id) ON DELETE RESTRICT, CONSTRAINT booking_requests_service FOREIGN KEY (service_id) REFERENCES crm_services(id) ON DELETE RESTRICT,
 INDEX booking_requests_customer (id_user, customer_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- 6. Fidélité et cartes cadeaux (registres append-only)
CREATE TABLE IF NOT EXISTS loyalty_settings (id_user INT NOT NULL PRIMARY KEY,is_enabled TINYINT(1) NOT NULL DEFAULT 0,points_per_euro INT UNSIGNED NOT NULL DEFAULT 1,reward_points INT UNSIGNED NOT NULL DEFAULT 100,reward_cents INT UNSIGNED NOT NULL DEFAULT 500,expires_after_days SMALLINT UNSIGNED NULL,updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,CONSTRAINT loyalty_settings_user FOREIGN KEY (id_user) REFERENCES users(id) ON DELETE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE IF NOT EXISTS loyalty_accounts (customer_id INT NOT NULL PRIMARY KEY,id_user INT NOT NULL,balance_points INT NOT NULL DEFAULT 0,updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,CONSTRAINT loyalty_accounts_customer FOREIGN KEY (customer_id) REFERENCES crm_customers(id) ON DELETE CASCADE,INDEX loyalty_accounts_owner (id_user, customer_id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE IF NOT EXISTS loyalty_ledger (id CHAR(36) NOT NULL PRIMARY KEY,id_user INT NOT NULL,customer_id INT NOT NULL,operation_key CHAR(64) NOT NULL,operation_type VARCHAR(40) NOT NULL,points_delta INT NOT NULL,balance_after INT NOT NULL,reason VARCHAR(500) NOT NULL,created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE KEY loyalty_ledger_operation (id_user, operation_key),CONSTRAINT loyalty_ledger_customer FOREIGN KEY (customer_id) REFERENCES crm_customers(id) ON DELETE RESTRICT,INDEX loyalty_ledger_history (id_user, customer_id, created_at)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE IF NOT EXISTS gift_cards (id CHAR(36) NOT NULL PRIMARY KEY,id_user INT NOT NULL,code VARCHAR(40) NOT NULL,initial_cents INT UNSIGNED NOT NULL,balance_cents INT UNSIGNED NOT NULL,expires_at DATE NULL,status ENUM('active','disabled','expired') NOT NULL DEFAULT 'active',created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE KEY gift_cards_code (code),INDEX gift_cards_owner (id_user, status),CONSTRAINT gift_cards_user FOREIGN KEY (id_user) REFERENCES users(id) ON DELETE RESTRICT) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE IF NOT EXISTS gift_card_ledger (id CHAR(36) NOT NULL PRIMARY KEY,id_user INT NOT NULL,gift_card_id CHAR(36) NOT NULL,operation_key CHAR(64) NOT NULL,operation_type VARCHAR(40) NOT NULL,amount_delta_cents INT NOT NULL,balance_after_cents INT UNSIGNED NOT NULL,reason VARCHAR(500) NOT NULL,created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE KEY gift_card_ledger_operation (id_user, operation_key),CONSTRAINT gift_card_ledger_card FOREIGN KEY (gift_card_id) REFERENCES gift_cards(id) ON DELETE RESTRICT,INDEX gift_card_ledger_history (id_user, gift_card_id, created_at)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
