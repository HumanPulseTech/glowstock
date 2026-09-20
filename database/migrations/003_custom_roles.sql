-- Rôles personnalisables et permissions GlowStock.
-- À exécuter une seule fois dans phpMyAdmin avant d'activer l'onglet Rôles.

ALTER TABLE users MODIFY role VARCHAR(50) NOT NULL DEFAULT 'user';

CREATE TABLE IF NOT EXISTS roles (
  id INT(11) NOT NULL AUTO_INCREMENT,
  slug VARCHAR(50) NOT NULL,
  nom VARCHAR(100) NOT NULL,
  permissions TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_roles_slug (slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

INSERT INTO roles (slug, nom, permissions) VALUES
('admin', 'Administrateur', '["dashboard","inventory","pao","manage_products","manage_pao","access_admin","manage_accounts","manage_subscriptions","manage_roles","bypass_subscription","delete_products","delete_accounts"]'),
('user', 'Utilisateur', '["dashboard","inventory","pao","manage_products","manage_pao"]'),
('sabo', 'Abonnement', '["dashboard","inventory","pao","manage_products","manage_pao"]')
ON DUPLICATE KEY UPDATE nom = VALUES(nom), permissions = VALUES(permissions);
