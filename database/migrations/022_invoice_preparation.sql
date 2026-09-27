-- Base GlowStock uniquement. Ajoute le socle de préparation des factures ;
-- aucune facture n'est émise ni transmise à une plateforme agréée par cette migration.
CREATE TABLE IF NOT EXISTS invoice_company_profiles (
 id_user INT NOT NULL PRIMARY KEY,
 legal_name VARCHAR(200) NOT NULL DEFAULT '',
 siret CHAR(14) NOT NULL DEFAULT '',
 vat_number VARCHAR(32) NOT NULL DEFAULT '',
 address VARCHAR(500) NOT NULL DEFAULT '',
 email VARCHAR(254) NOT NULL DEFAULT '',
 phone VARCHAR(40) NOT NULL DEFAULT '',
 iban VARCHAR(34) NOT NULL DEFAULT '',
 payment_terms VARCHAR(500) NOT NULL DEFAULT '',
 updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS invoice_templates (
 id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
 id_user INT NOT NULL,
 name VARCHAR(100) NOT NULL,
 logo_url VARCHAR(500) NOT NULL DEFAULT '',
 primary_color CHAR(7) NOT NULL DEFAULT '#4b7158',
 accent_color CHAR(7) NOT NULL DEFAULT '#efe1d6',
 footer VARCHAR(1000) NOT NULL DEFAULT '',
 is_default TINYINT(1) NOT NULL DEFAULT 1,
 version INT NOT NULL DEFAULT 1,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE KEY invoice_template_name (id_user, name),
 INDEX invoice_template_default (id_user, is_default)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS invoice_customer_profiles (
 customer_id INT NOT NULL PRIMARY KEY,
 id_user INT NOT NULL,
 company_name VARCHAR(200) NOT NULL DEFAULT '',
 siret CHAR(14) NOT NULL DEFAULT '',
 vat_number VARCHAR(32) NOT NULL DEFAULT '',
 billing_address VARCHAR(500) NOT NULL DEFAULT '',
 invoice_email VARCHAR(254) NOT NULL DEFAULT '',
 electronic_address VARCHAR(254) NOT NULL DEFAULT '',
 version INT NOT NULL DEFAULT 1,
 updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 INDEX invoice_customer_owner (id_user, company_name),
 CONSTRAINT invoice_customer_profile_customer FOREIGN KEY (customer_id) REFERENCES crm_customers(id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS invoice_drafts (
 id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
 id_user INT NOT NULL,
 customer_id INT NULL,
 template_id INT NULL,
 label VARCHAR(200) NOT NULL DEFAULT '',
 data LONGTEXT NOT NULL CHECK (JSON_VALID(data)),
 version INT NOT NULL DEFAULT 1,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 INDEX invoice_draft_owner (id_user, updated_at),
 CONSTRAINT invoice_draft_customer FOREIGN KEY (customer_id) REFERENCES crm_customers(id),
 CONSTRAINT invoice_draft_template FOREIGN KEY (template_id) REFERENCES invoice_templates(id)
) ENGINE=InnoDB;
