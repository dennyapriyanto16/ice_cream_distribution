USE ice_distribution;

ALTER TABLE delivery_routes
  MODIFY task_type ENUM('RESTOCK', 'MAINTENANCE', 'OFFER') NOT NULL DEFAULT 'RESTOCK';
