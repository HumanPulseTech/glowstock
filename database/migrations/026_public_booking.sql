-- Base GlowStock uniquement. Réservation publique, sans accès direct à la Caisse.
CREATE TABLE IF NOT EXISTS booking_settings (
 id_user INT NOT NULL PRIMARY KEY,
 slug VARCHAR(80) NOT NULL UNIQUE,
 is_enabled TINYINT(1) NOT NULL DEFAULT 0,
 buffer_minutes SMALLINT UNSIGNED NOT NULL DEFAULT 0,
 cancellation_hours SMALLINT UNSIGNED NOT NULL DEFAULT 24,
 updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 CONSTRAINT booking_settings_user FOREIGN KEY (id_user) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE IF NOT EXISTS booking_closures (
 id CHAR(36) NOT NULL PRIMARY KEY,
 id_user INT NOT NULL,
 closure_date DATE NOT NULL,
 reason VARCHAR(150) NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE KEY booking_closure_day (id_user, closure_date),
 CONSTRAINT booking_closures_user FOREIGN KEY (id_user) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE IF NOT EXISTS booking_requests (
 id CHAR(36) NOT NULL PRIMARY KEY,
 id_user INT NOT NULL,
 appointment_id INT NOT NULL UNIQUE,
 customer_id INT NOT NULL,
 service_id INT NOT NULL,
 email VARCHAR(254) NOT NULL,
 cancellation_token_hash CHAR(64) NOT NULL UNIQUE,
 status ENUM('confirmed','cancelled') NOT NULL DEFAULT 'confirmed',
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 cancelled_at DATETIME NULL,
 CONSTRAINT booking_requests_user FOREIGN KEY (id_user) REFERENCES users(id) ON DELETE CASCADE,
 CONSTRAINT booking_requests_appointment FOREIGN KEY (appointment_id) REFERENCES planning_entries(id) ON DELETE RESTRICT,
 CONSTRAINT booking_requests_customer FOREIGN KEY (customer_id) REFERENCES crm_customers(id) ON DELETE RESTRICT,
 CONSTRAINT booking_requests_service FOREIGN KEY (service_id) REFERENCES crm_services(id) ON DELETE RESTRICT,
 INDEX booking_requests_customer (id_user, customer_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
