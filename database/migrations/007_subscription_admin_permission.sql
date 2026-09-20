-- Ajoute le droit dédié à la gestion des abonnements au rôle administrateur.
-- À exécuter après 003_custom_roles.sql.
UPDATE roles
SET permissions = JSON_ARRAY_APPEND(permissions, '$', 'manage_subscriptions')
WHERE slug = 'admin'
  AND JSON_VALID(permissions)
  AND JSON_CONTAINS(permissions, JSON_QUOTE('manage_subscriptions')) = 0;
