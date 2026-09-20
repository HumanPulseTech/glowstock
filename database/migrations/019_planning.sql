-- Planning hebdomadaire par compte GlowStock.
-- Les horaires sont indexés de 0 (lundi) à 6 (dimanche).

CREATE TABLE IF NOT EXISTS planning_business_hours (
  id_user INT(11) NOT NULL,
  day_of_week TINYINT UNSIGNED NOT NULL,
  is_open TINYINT(1) NOT NULL DEFAULT 1,
  opens_at TIME NULL,
  closes_at TIME NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id_user, day_of_week),
  CONSTRAINT fk_planning_business_hours_user FOREIGN KEY (id_user) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS planning_entries (
  id INT(11) NOT NULL AUTO_INCREMENT,
  id_user INT(11) NOT NULL,
  appointment_date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  client_name VARCHAR(150) NOT NULL,
  service_name VARCHAR(150) NULL,
  notes VARCHAR(2000) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_planning_entries_user_date_time (id_user, appointment_date, start_time),
  CONSTRAINT fk_planning_entries_user FOREIGN KEY (id_user) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
