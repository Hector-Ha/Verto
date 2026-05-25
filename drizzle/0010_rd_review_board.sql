CREATE TABLE `idea_rankings` (
  `id` varchar(64) NOT NULL,
  `campaign_id` varchar(64) NOT NULL,
  `idea_id` varchar(64) NOT NULL,
  `family_id` varchar(64) NULL,
  `rank_position` int NOT NULL,
  `rank_reasons` json NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `idea_rankings_campaign_idea` (`campaign_id`, `idea_id`),
  CONSTRAINT `idea_rankings_campaign_id_campaigns_id_fk` FOREIGN KEY (`campaign_id`) REFERENCES `campaigns` (`id`) ON DELETE cascade,
  CONSTRAINT `idea_rankings_idea_id_ideas_id_fk` FOREIGN KEY (`idea_id`) REFERENCES `ideas` (`id`) ON DELETE cascade,
  CONSTRAINT `idea_rankings_family_id_idea_families_id_fk` FOREIGN KEY (`family_id`) REFERENCES `idea_families` (`id`) ON DELETE set null
);

CREATE TABLE `idea_review_recommendations` (
  `id` varchar(64) NOT NULL,
  `campaign_id` varchar(64) NOT NULL,
  `idea_id` varchar(64) NOT NULL,
  `family_id` varchar(64) NULL,
  `recommended_outcome` enum('potential_idea','future_opportunity','inactive_idea') NOT NULL,
  `reason_tag` varchar(64) NOT NULL,
  `reason_note` text NULL,
  `recommended_by_user_id` varchar(64) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  CONSTRAINT `idea_review_recommendations_campaign_id_campaigns_id_fk` FOREIGN KEY (`campaign_id`) REFERENCES `campaigns` (`id`) ON DELETE cascade,
  CONSTRAINT `idea_review_recommendations_idea_id_ideas_id_fk` FOREIGN KEY (`idea_id`) REFERENCES `ideas` (`id`) ON DELETE cascade,
  CONSTRAINT `idea_review_recommendations_family_id_idea_families_id_fk` FOREIGN KEY (`family_id`) REFERENCES `idea_families` (`id`) ON DELETE set null,
  CONSTRAINT `idea_review_recommendations_recommended_by_user_id_users_id_fk` FOREIGN KEY (`recommended_by_user_id`) REFERENCES `users` (`id`) ON DELETE cascade
);

CREATE TABLE `idea_review_outcomes` (
  `id` varchar(64) NOT NULL,
  `campaign_id` varchar(64) NOT NULL,
  `idea_id` varchar(64) NOT NULL,
  `family_id` varchar(64) NULL,
  `outcome` enum('potential_idea','future_opportunity','inactive_idea') NOT NULL,
  `reason_tag` varchar(64) NOT NULL,
  `reason_note` text NULL,
  `decided_by_user_id` varchar(64) NOT NULL,
  `decided_at` timestamp NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `idea_review_outcomes_campaign_idea` (`campaign_id`, `idea_id`),
  CONSTRAINT `idea_review_outcomes_campaign_id_campaigns_id_fk` FOREIGN KEY (`campaign_id`) REFERENCES `campaigns` (`id`) ON DELETE cascade,
  CONSTRAINT `idea_review_outcomes_idea_id_ideas_id_fk` FOREIGN KEY (`idea_id`) REFERENCES `ideas` (`id`) ON DELETE cascade,
  CONSTRAINT `idea_review_outcomes_family_id_idea_families_id_fk` FOREIGN KEY (`family_id`) REFERENCES `idea_families` (`id`) ON DELETE set null,
  CONSTRAINT `idea_review_outcomes_decided_by_user_id_users_id_fk` FOREIGN KEY (`decided_by_user_id`) REFERENCES `users` (`id`) ON DELETE cascade
);
