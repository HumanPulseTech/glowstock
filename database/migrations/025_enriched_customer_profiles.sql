-- Base GlowStock uniquement. Ajouts compatibles avec le CRM existant.
-- Les photos et documents sont chiffrés en transit (HTTPS) et ne sont servis qu'après contrôle de session côté serveur.
CREATE TABLE IF NOT EXISTS crm_customer_profiles (
 customer_id INT NOT NULL PRIMARY KEY,
 id_user INT NOT NULL,
 preferences TEXT NOT NULL,
 observations TEXT NOT NULL,
 version INT NOT NULL DEFAULT 1,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 CONSTRAINT crm_customer_profiles_customer FOREIGN KEY (customer_id) REFERENCES crm_customers(id) ON DELETE CASCADE,
 INDEX crm_customer_profiles_owner (id_user, customer_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Append-only: un retrait est une nouvelle ligne, jamais une réécriture du consentement précédent.
CREATE TABLE IF NOT EXISTS crm_customer_consents (
 id CHAR(36) NOT NULL PRIMARY KEY,
 id_user INT NOT NULL,
 customer_id INT NOT NULL,
 consent_type VARCHAR(100) NOT NULL,
 action ENUM('granted','revoked') NOT NULL,
 details VARCHAR(500) NULL,
 captured_by INT NOT NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT crm_customer_consents_customer FOREIGN KEY (customer_id) REFERENCES crm_customers(id) ON DELETE CASCADE,
 INDEX crm_customer_consents_history (id_user, customer_id, consent_type, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS crm_customer_media (
 id CHAR(36) NOT NULL PRIMARY KEY,
 id_user INT NOT NULL,
 customer_id INT NOT NULL,
 kind ENUM('before_after_photo','document') NOT NULL,
 filename VARCHAR(180) NOT NULL,
 mime_type VARCHAR(80) NOT NULL,
 byte_size INT UNSIGNED NOT NULL,
 sha256 CHAR(64) NOT NULL,
 blob_data MEDIUMBLOB NULL,
 created_by INT NOT NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 deleted_at DATETIME NULL,
 CONSTRAINT crm_customer_media_customer FOREIGN KEY (customer_id) REFERENCES crm_customers(id) ON DELETE CASCADE,
 INDEX crm_customer_media_owner (id_user, customer_id, deleted_at, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
