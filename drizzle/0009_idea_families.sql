CREATE TABLE `idea_families` (
  `id` varchar(64) NOT NULL,
  `campaign_id` varchar(64) NOT NULL,
  `primary_idea_id` varchar(64) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idea_families_campaign_idx` (`campaign_id`),
  KEY `idea_families_primary_idea_idx` (`primary_idea_id`),
  CONSTRAINT `idea_families_campaign_fk` FOREIGN KEY (`campaign_id`) REFERENCES `campaigns` (`id`) ON DELETE CASCADE,
  CONSTRAINT `idea_families_primary_idea_fk` FOREIGN KEY (`primary_idea_id`) REFERENCES `ideas` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `idea_family_members` (
  `family_id` varchar(64) NOT NULL,
  `idea_id` varchar(64) NOT NULL,
  `relationship_type` enum('primary','exact_duplicate','related_submission','variant') NOT NULL,
  `variant_difference` text,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`family_id`, `idea_id`),
  UNIQUE KEY `idea_family_members_idea_unique` (`idea_id`),
  KEY `idea_family_members_idea_idx` (`idea_id`),
  CONSTRAINT `idea_family_members_family_fk` FOREIGN KEY (`family_id`) REFERENCES `idea_families` (`id`) ON DELETE CASCADE,
  CONSTRAINT `idea_family_members_idea_fk` FOREIGN KEY (`idea_id`) REFERENCES `ideas` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `idea_review_summaries` (
  `id` varchar(64) NOT NULL,
  `family_id` varchar(64) NOT NULL,
  `campaign_id` varchar(64) NOT NULL,
  `ai_decision_log_id` varchar(64),
  `requested_by_user_id` varchar(64),
  `version` int NOT NULL,
  `summary_text` text NOT NULL,
  `source_trace` json NOT NULL,
  `ai_reason` text NOT NULL,
  `is_current` tinyint(1) NOT NULL DEFAULT 1,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idea_review_summaries_family_idx` (`family_id`),
  KEY `idea_review_summaries_campaign_idx` (`campaign_id`),
  KEY `idea_review_summaries_ai_log_idx` (`ai_decision_log_id`),
  KEY `idea_review_summaries_requested_by_idx` (`requested_by_user_id`),
  CONSTRAINT `idea_review_summaries_family_fk` FOREIGN KEY (`family_id`) REFERENCES `idea_families` (`id`) ON DELETE CASCADE,
  CONSTRAINT `idea_review_summaries_campaign_fk` FOREIGN KEY (`campaign_id`) REFERENCES `campaigns` (`id`) ON DELETE CASCADE,
  CONSTRAINT `idea_review_summaries_ai_log_fk` FOREIGN KEY (`ai_decision_log_id`) REFERENCES `ai_decision_logs` (`id`) ON DELETE SET NULL,
  CONSTRAINT `idea_review_summaries_requested_by_fk` FOREIGN KEY (`requested_by_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
