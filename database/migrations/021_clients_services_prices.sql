-- Base GlowStock (PAS la base du service Caisse). Sauvegarder avant application.
-- Ajouts uniquement : aucune suppression ni réécriture des données existantes.
CREATE TABLE IF NOT EXISTS crm_customers (
 id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
 id_user INT NOT NULL,
 name VARCHAR(150) NOT NULL,
 email VARCHAR(254) NOT NULL DEFAULT '',
 phone VARCHAR(40) NOT NULL DEFAULT '',
 address VARCHAR(500) NOT NULL DEFAULT '',
 notes VARCHAR(2000) NOT NULL DEFAULT '',
 version INT NOT NULL DEFAULT 1,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 INDEX (id_user, name)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS crm_services (
 id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
 id_user INT NOT NULL,
 name VARCHAR(150) NOT NULL,
 price_cents INT UNSIGNED NOT NULL,
 tax_mode VARCHAR(10) NOT NULL,
 tax_bps INT UNSIGNED NOT NULL,
 duration_minutes INT UNSIGNED NOT NULL DEFAULT 60,
 description VARCHAR(2000) NOT NULL DEFAULT '',
 version INT NOT NULL DEFAULT 1,
 INDEX (id_user, name)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS crm_service_products (
 service_id INT NOT NULL,
 product_id INT NOT NULL,
 PRIMARY KEY (service_id, product_id),
 FOREIGN KEY (service_id) REFERENCES crm_services(id) ON DELETE CASCADE
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS crm_appointment_links (
 appointment_id INT NOT NULL PRIMARY KEY,
 id_user INT NOT NULL,
 customer_id INT NULL,
 service_id INT NULL,
 INDEX (id_user, customer_id),
 FOREIGN KEY (customer_id) REFERENCES crm_customers(id),
 FOREIGN KEY (service_id) REFERENCES crm_services(id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS product_prices (
 product_id INT NOT NULL PRIMARY KEY,
 id_user INT NOT NULL,
 price_cents INT UNSIGNED NULL,
 INDEX (id_user)
) ENGINE=InnoDB;
