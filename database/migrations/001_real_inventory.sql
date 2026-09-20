-- GlowStock: structure nécessaire pour l'inventaire multi-utilisateur et la PAO.
-- À exécuter une seule fois après sauvegarde de la base de production.

START TRANSACTION;

DELETE FROM sessions;
UPDATE users SET Token = NULL;

-- Supprime uniquement le compte de démonstration présent dans l'export fourni.
DELETE FROM users WHERE email = 'test@test.fr';

ALTER TABLE produits
  DROP INDEX ref_fournisseur,
  ADD UNIQUE KEY uq_produits_user_reference (id_user, ref_fournisseur),
  ADD KEY idx_produits_user_stock (id_user, quantite, seuil_alerte);

ALTER TABLE historique
  ADD KEY idx_historique_user_article (id_user, id_art);

ALTER TABLE PAO
  ADD PRIMARY KEY (id),
  MODIFY id INT(11) NOT NULL AUTO_INCREMENT,
  MODIFY ref VARCHAR(100) NOT NULL,
  ADD KEY idx_pao_produit_active_fin (id_produit, active, dFin),
  ADD UNIQUE KEY uq_pao_produit_reference (id_produit, ref);

ALTER TABLE produits
  ADD CONSTRAINT fk_produits_user FOREIGN KEY (id_user) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE PAO
  ADD CONSTRAINT fk_pao_produit FOREIGN KEY (id_produit) REFERENCES produits(id) ON DELETE CASCADE;

ALTER TABLE historique
  ADD CONSTRAINT fk_historique_user FOREIGN KEY (id_user) REFERENCES users(id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_historique_produit FOREIGN KEY (id_art) REFERENCES produits(id) ON DELETE RESTRICT;

COMMIT;
