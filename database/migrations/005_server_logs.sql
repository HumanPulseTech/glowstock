CREATE TABLE IF NOT EXISTS server_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  level VARCHAR(16) NOT NULL,
  event VARCHAR(100) NOT NULL,
  message VARCHAR(2000) NOT NULL,
  id_user INT(11) NULL,
  request_id VARCHAR(80) NULL,
  socket_id VARCHAR(80) NULL,
  context TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_server_logs_created (created_at),
  KEY idx_server_logs_event (event),
  KEY idx_server_logs_user_created (id_user, created_at),
  CONSTRAINT fk_server_logs_user FOREIGN KEY (id_user) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
