-- Interrupteurs indépendants pour la connexion et l'inscription.

INSERT IGNORE INTO feature_flags (feature_key, enabled) VALUES
  ('login', 1),
  ('signup', 1);
