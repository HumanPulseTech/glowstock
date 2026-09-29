-- Base GlowStock uniquement. Migration additive : ne pas rejouer les anciennes migrations d'inventaire.
ALTER TABLE produits ADD COLUMN IF NOT EXISTS fournisseur VARCHAR(150) NULL AFTER marque;
ALTER TABLE produits ADD COLUMN IF NOT EXISTS prix_achat_centimes INT UNSIGNED NULL AFTER fournisseur;

CREATE TABLE IF NOT EXISTS stock_imports (
 id CHAR(36) NOT NULL PRIMARY KEY,
 id_user INT NOT NULL,
 source_filename VARCHAR(255) NOT NULL,
 source_sha256 CHAR(64) NOT NULL,
 status VARCHAR(20) NOT NULL,
 raw_rows LONGTEXT NOT NULL CHECK (JSON_VALID(raw_rows)),
 mapping_json LONGTEXT NULL CHECK (mapping_json IS NULL OR JSON_VALID(mapping_json)),
 report_json LONGTEXT NULL CHECK (report_json IS NULL OR JSON_VALID(report_json)),
 committed_at DATETIME NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 KEY stock_imports_owner (id_user, created_at),
 CONSTRAINT stock_imports_user FOREIGN KEY (id_user) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS stock_movements (
 id CHAR(36) NOT NULL PRIMARY KEY,
 id_user INT NOT NULL,
 product_id INT NOT NULL,
 import_id CHAR(36) NULL,
 source_row INT NULL,
 movement_type VARCHAR(50) NOT NULL,
 quantity_delta INT NOT NULL,
 quantity_after INT NOT NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE KEY stock_movement_import_row (import_id, source_row),
 KEY stock_movements_product (id_user, product_id, created_at),
 CONSTRAINT stock_movements_user FOREIGN KEY (id_user) REFERENCES users(id) ON DELETE RESTRICT,
 CONSTRAINT stock_movements_product FOREIGN KEY (product_id) REFERENCES produits(id) ON DELETE RESTRICT,
 CONSTRAINT stock_movements_import FOREIGN KEY (import_id) REFERENCES stock_imports(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
