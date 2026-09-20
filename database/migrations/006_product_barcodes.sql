-- Sépare le code-barres de la référence fournisseur.
ALTER TABLE produits
  ADD COLUMN IF NOT EXISTS code_barres VARCHAR(100) NULL AFTER ref_fournisseur;

ALTER TABLE produits
  ADD UNIQUE KEY uq_produits_user_code_barres (id_user, code_barres);
