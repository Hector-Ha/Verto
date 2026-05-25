CREATE TABLE `idea_classification_groups` (
  `id` varchar(64) NOT NULL,
  `campaign_id` varchar(64) NOT NULL,
  `name` varchar(255) NOT NULL,
  `group_type` enum('standard','single_idea','emerging_theme') NOT NULL,
  `summary_text` text NOT NULL,
  `context_version` varchar(255) NOT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `rank_position` int NULL,
  `ranking_context_version` varchar(255) NULL,
  `ranked_at` timestamp NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `idea_classification_groups_campaign_name` (`campaign_id`, `name`),
  KEY `idea_classification_groups_campaign_active_idx` (`campaign_id`, `is_active`),
  CONSTRAINT `idea_classification_groups_campaign_fk` FOREIGN KEY (`campaign_id`) REFERENCES `campaigns` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `idea_classification_group_members` (
  `group_id` varchar(64) NOT NULL,
  `idea_id` varchar(64) NOT NULL,
  `is_primary` tinyint(1) NOT NULL DEFAULT 0,
  `placement_reason` text NOT NULL,
  `context_version` varchar(255) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`group_id`, `idea_id`),
  KEY `idea_classification_group_members_idea_idx` (`idea_id`),
  KEY `idea_classification_group_members_primary_idx` (`idea_id`, `is_primary`),
  CONSTRAINT `idea_classification_group_members_group_fk` FOREIGN KEY (`group_id`) REFERENCES `idea_classification_groups` (`id`) ON DELETE CASCADE,
  CONSTRAINT `idea_classification_group_members_idea_fk` FOREIGN KEY (`idea_id`) REFERENCES `ideas` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
