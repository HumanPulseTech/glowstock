-- Offres affichées sur la page d'accueil et administrables depuis GlowStock.

CREATE TABLE IF NOT EXISTS marketing_offers (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(160) NOT NULL,
  description VARCHAR(1000) NULL,
  price DECIMAL(10,2) NOT NULL,
  original_price DECIMAL(10,2) NULL,
  discount_label VARCHAR(100) NULL,
  billing_period VARCHAR(50) NOT NULL DEFAULT '/ mois',
  features TEXT NOT NULL,
  included_access TEXT NULL,
  cta_label VARCHAR(100) NOT NULL DEFAULT 'Commencer l’essai de 14 jours',
  active TINYINT(1) NOT NULL DEFAULT 1,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_marketing_offers_active_order (active, sort_order, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
