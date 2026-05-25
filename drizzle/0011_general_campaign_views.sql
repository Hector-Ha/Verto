CREATE TABLE `general_campaign_review_packets` (
  `id` varchar(64) NOT NULL,
  `campaign_id` varchar(64) NOT NULL,
  `packet_text` text NOT NULL,
  `context_version` varchar(255) NOT NULL,
  `created_by_user_id` varchar(64) NOT NULL,
  `is_current` tinyint(1) NOT NULL DEFAULT 1,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `general_campaign_review_packets_campaign_idx` (`campaign_id`),
  KEY `general_campaign_review_packets_current_idx` (`campaign_id`, `is_current`),
  CONSTRAINT `general_campaign_review_packets_campaign_fk` FOREIGN KEY (`campaign_id`) REFERENCES `campaigns` (`id`) ON DELETE CASCADE,
  CONSTRAINT `general_campaign_review_packets_created_by_fk` FOREIGN KEY (`created_by_user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
