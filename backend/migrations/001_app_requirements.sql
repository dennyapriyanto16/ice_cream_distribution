USE ice_distribution;

ALTER TABLE users
  ADD COLUMN username VARCHAR(80) NULL,
  ADD COLUMN password_hash VARCHAR(255) NULL,
  ADD UNIQUE KEY uq_users_username (username);

ALTER TABLE stock_status
  ADD UNIQUE KEY uq_stock_status_outlet (outlet_id);

ALTER TABLE delivery_routes
  ADD COLUMN stop_order INT NOT NULL DEFAULT 1,
  ADD COLUMN freezer_id INT NULL,
  ADD KEY idx_delivery_route_day (task_type, scheduled_date, stop_order);

UPDATE delivery_routes r
JOIN freezers f ON f.outlet_id = r.target_outlet_id
SET r.freezer_id = f.freezer_id
WHERE r.task_type = 'MAINTENANCE';

ALTER TABLE delivery_routes
  ADD KEY idx_delivery_route_freezer (freezer_id),
  ADD CONSTRAINT fk_delivery_route_freezer
    FOREIGN KEY (freezer_id) REFERENCES freezers (freezer_id) ON DELETE SET NULL;

CREATE TABLE maintenance_settings (
  setting_id TINYINT NOT NULL PRIMARY KEY,
  workdays JSON NOT NULL,
  daily_capacity INT NOT NULL DEFAULT 4,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT chk_maintenance_capacity CHECK (daily_capacity > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT INTO maintenance_settings (setting_id, workdays, daily_capacity)
VALUES (1, JSON_ARRAY('MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'), 4);
