-- Base GlowStock uniquement. Intégration réservation → planning → fiche cliente.
-- Une réservation annulée reste traçable : aucun rendez-vous lié n'est supprimé.
ALTER TABLE planning_entries
 ADD COLUMN IF NOT EXISTS status ENUM('confirmed','cancelled') NOT NULL DEFAULT 'confirmed',
 ADD COLUMN IF NOT EXISTS cancelled_at DATETIME NULL,
 ADD COLUMN IF NOT EXISTS cancellation_reason VARCHAR(500) NULL,
 ADD INDEX IF NOT EXISTS planning_entries_active_slot (id_user,status,appointment_date,start_time);
