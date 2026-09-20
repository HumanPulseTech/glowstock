-- Interrupteurs globaux des fonctionnalités GlowStock.
-- La table est aussi créée automatiquement lors du premier accès à l'administration.

CREATE TABLE IF NOT EXISTS feature_flags (
  feature_key VARCHAR(50) NOT NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  updated_by_user_id INT(11) NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (feature_key),
  KEY idx_feature_flags_updated_by (updated_by_user_id),
  CONSTRAINT fk_feature_flags_updated_by FOREIGN KEY (updated_by_user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

INSERT IGNORE INTO feature_flags (feature_key, enabled) VALUES
  ('login', 1),
  ('signup', 1),
  ('dashboard', 1),
  ('inventory', 1),
  ('products', 1),
  ('scanner', 1),
  ('pao', 1),
  ('planning', 1),
  ('tickets', 1),
  ('notifications', 1);
