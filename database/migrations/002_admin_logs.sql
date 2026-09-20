CREATE TABLE IF NOT EXISTS error_logs (
  id INT(11) NOT NULL AUTO_INCREMENT,
  id_user INT(11) NULL,
  type VARCHAR(50) NOT NULL,
  message TEXT NOT NULL,
  context TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_error_logs_created (created_at),
  KEY idx_error_logs_user_created (id_user, created_at),
  CONSTRAINT fk_error_logs_user FOREIGN KEY (id_user) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
