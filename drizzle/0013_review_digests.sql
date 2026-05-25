CREATE TABLE `review_digests` (
  `id` varchar(64) NOT NULL,
  `campaign_id` varchar(64) NOT NULL,
  `cadence` enum('daily','weekly') NOT NULL,
  `window_started_at` timestamp NOT NULL,
  `window_ended_at` timestamp NOT NULL,
  `generated_at` timestamp NOT NULL,
  `summary` text NOT NULL,
  `item_count` int NOT NULL DEFAULT 0,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `review_digests_campaign_unique` (`campaign_id`),
  KEY `review_digests_campaign_generated_idx` (`campaign_id`, `generated_at`),
  CONSTRAINT `review_digests_campaign_fk` FOREIGN KEY (`campaign_id`) REFERENCES `campaigns` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `review_digest_items` (
  `id` varchar(64) NOT NULL,
  `digest_id` varchar(64) NOT NULL,
  `campaign_id` varchar(64) NOT NULL,
  `item_type` enum('new_review_ready','clarification_expiring','major_routing_change','rerank_summary') NOT NULL,
  `idea_id` varchar(64) NULL,
  `title` varchar(255) NOT NULL,
  `body` text NOT NULL,
  `link_label` varchar(128) NOT NULL,
  `link_href` varchar(255) NOT NULL,
  `sort_order` int NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `review_digest_items_digest_idx` (`digest_id`),
  KEY `review_digest_items_campaign_idx` (`campaign_id`),
  KEY `review_digest_items_idea_idx` (`idea_id`),
  CONSTRAINT `review_digest_items_digest_fk` FOREIGN KEY (`digest_id`) REFERENCES `review_digests` (`id`) ON DELETE CASCADE,
  CONSTRAINT `review_digest_items_campaign_fk` FOREIGN KEY (`campaign_id`) REFERENCES `campaigns` (`id`) ON DELETE CASCADE,
  CONSTRAINT `review_digest_items_idea_fk` FOREIGN KEY (`idea_id`) REFERENCES `ideas` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
