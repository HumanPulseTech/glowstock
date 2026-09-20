-- Système de tickets GlowStock : équipes, états, attribution et historique.
-- À exécuter une seule fois avant d'activer l'onglet Tickets.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS ticket_team VARCHAR(50) NULL AFTER role;

CREATE TABLE IF NOT EXISTS ticket_teams (
  id INT(11) NOT NULL AUTO_INCREMENT,
  slug VARCHAR(50) NOT NULL,
  nom VARCHAR(100) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_ticket_teams_slug (slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

INSERT INTO ticket_teams (slug, nom) VALUES
  ('dev', 'Développement'),
  ('sav', 'Service après-vente'),
  ('contentieux', 'Contentieux'),
  ('fondateur', 'Fondateur')
ON DUPLICATE KEY UPDATE nom = VALUES(nom);

CREATE TABLE IF NOT EXISTS tickets (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  titre VARCHAR(200) NOT NULL,
  description TEXT NOT NULL,
  categorie VARCHAR(40) NOT NULL DEFAULT 'bug',
  equipe VARCHAR(50) NOT NULL,
  statut VARCHAR(30) NOT NULL DEFAULT 'non_traite',
  demandeur_id INT(11) NULL,
  assigne_id INT(11) NULL,
  cout_total DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  temps_total_minutes INT(11) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  resolved_at DATETIME NULL,
  reclamation_utilisee_at DATETIME NULL,
  reclamation_message TEXT NULL,
  reclamation_decision VARCHAR(30) NULL,
  reclamation_decision_note TEXT NULL,
  reclamation_decidee_par INT(11) NULL,
  reclamation_decidee_at DATETIME NULL,
  reclamation_previous_team VARCHAR(50) NULL,
  reclamation_previous_status VARCHAR(30) NULL,
  reclamation_previous_assignee_id INT(11) NULL,
  PRIMARY KEY (id),
  KEY idx_tickets_team_status (equipe, statut, updated_at),
  KEY idx_tickets_assignee (assigne_id, statut),
  KEY idx_tickets_requester (demandeur_id, created_at),
  CONSTRAINT fk_tickets_requester FOREIGN KEY (demandeur_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_tickets_assignee FOREIGN KEY (assigne_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Compatibilité avec une table tickets déjà créée avant l'ajout des catégories.
ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS categorie VARCHAR(40) NOT NULL DEFAULT 'bug' AFTER description;

ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS reclamation_utilisee_at DATETIME NULL AFTER resolved_at,
  ADD COLUMN IF NOT EXISTS reclamation_message TEXT NULL AFTER reclamation_utilisee_at,
  ADD COLUMN IF NOT EXISTS reclamation_decision VARCHAR(30) NULL AFTER reclamation_message,
  ADD COLUMN IF NOT EXISTS reclamation_decision_note TEXT NULL AFTER reclamation_decision,
  ADD COLUMN IF NOT EXISTS reclamation_decidee_par INT(11) NULL AFTER reclamation_decision_note,
  ADD COLUMN IF NOT EXISTS reclamation_decidee_at DATETIME NULL AFTER reclamation_decidee_par,
  ADD COLUMN IF NOT EXISTS reclamation_previous_team VARCHAR(50) NULL AFTER reclamation_decidee_at,
  ADD COLUMN IF NOT EXISTS reclamation_previous_status VARCHAR(30) NULL AFTER reclamation_previous_team,
  ADD COLUMN IF NOT EXISTS reclamation_previous_assignee_id INT(11) NULL AFTER reclamation_previous_status;

CREATE TABLE IF NOT EXISTS ticket_updates (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  ticket_id BIGINT UNSIGNED NOT NULL,
  user_id INT(11) NULL,
  action VARCHAR(40) NOT NULL DEFAULT 'note',
  contenu TEXT NULL,
  statut VARCHAR(30) NULL,
  equipe VARCHAR(50) NULL,
  assigne_id INT(11) NULL,
  cout_delta DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  temps_delta_minutes INT(11) NOT NULL DEFAULT 0,
  meta TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_ticket_updates_ticket (ticket_id, created_at),
  KEY idx_ticket_updates_user (user_id, created_at),
  CONSTRAINT fk_ticket_updates_ticket FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE,
  CONSTRAINT fk_ticket_updates_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_ticket_updates_assignee FOREIGN KEY (assigne_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Permissions nécessaires au module. Elles restent modifiables depuis l'onglet Rôles.
UPDATE roles
SET permissions = JSON_ARRAY_APPEND(permissions, '$', 'tickets_view')
WHERE slug IN ('admin', 'fondateur') AND JSON_VALID(permissions) AND JSON_CONTAINS(permissions, JSON_QUOTE('tickets_view')) = 0;
UPDATE roles
SET permissions = JSON_ARRAY_APPEND(permissions, '$', 'tickets_manage')
WHERE slug IN ('admin', 'fondateur') AND JSON_VALID(permissions) AND JSON_CONTAINS(permissions, JSON_QUOTE('tickets_manage')) = 0;
UPDATE roles
SET permissions = JSON_ARRAY_APPEND(permissions, '$', 'tickets_assign')
WHERE slug IN ('admin', 'fondateur') AND JSON_VALID(permissions) AND JSON_CONTAINS(permissions, JSON_QUOTE('tickets_assign')) = 0;
UPDATE roles
SET permissions = JSON_ARRAY_APPEND(permissions, '$', 'tickets_all')
WHERE slug IN ('admin', 'fondateur') AND JSON_VALID(permissions) AND JSON_CONTAINS(permissions, JSON_QUOTE('tickets_all')) = 0;

INSERT INTO roles (slug, nom, permissions) VALUES
  ('fondateur', 'Fondateur', '["dashboard","inventory","pao","manage_products","manage_pao","access_admin","manage_accounts","manage_subscriptions","manage_roles","bypass_subscription","delete_products","delete_accounts","tickets_view","tickets_manage","tickets_assign","tickets_all"]')
ON DUPLICATE KEY UPDATE nom = VALUES(nom);
