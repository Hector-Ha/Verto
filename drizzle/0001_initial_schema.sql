CREATE TABLE `users` (
  `id` varchar(64) NOT NULL,
  `email` varchar(255) NOT NULL,
  `display_name` varchar(255) NOT NULL,
  `department` varchar(255),
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `users_email_unique` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `roles` (
  `id` varchar(64) NOT NULL,
  `name` varchar(128) NOT NULL,
  `description` text,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `user_roles` (
  `user_id` varchar(64) NOT NULL,
  `role_id` varchar(64) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`user_id`, `role_id`),
  CONSTRAINT `user_roles_user_fk` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `user_roles_role_fk` FOREIGN KEY (`role_id`) REFERENCES `roles` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `campaigns` (
  `id` varchar(64) NOT NULL,
  `type` enum('general','specific') NOT NULL,
  `name` varchar(255) NOT NULL,
  `public_title` varchar(255) NOT NULL,
  `public_prompt` text NOT NULL,
  `lifecycle_status` enum('always_open','draft','setup_in_progress','setup_review','ready_to_open','intake_scheduled','intake_open','intake_closed','review_in_progress','review_complete','retrospective','ended') NOT NULL,
  `intake_starts_at` timestamp NULL,
  `intake_ends_at` timestamp NULL,
  `created_by_user_id` varchar(64) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `campaigns_created_by_idx` (`created_by_user_id`),
  CONSTRAINT `campaigns_created_by_fk` FOREIGN KEY (`created_by_user_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `campaign_memberships` (
  `campaign_id` varchar(64) NOT NULL,
  `user_id` varchar(64) NOT NULL,
  `membership_role` enum('manager','owner','member') NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`campaign_id`, `user_id`, `membership_role`),
  CONSTRAINT `campaign_memberships_campaign_fk` FOREIGN KEY (`campaign_id`) REFERENCES `campaigns` (`id`) ON DELETE CASCADE,
  CONSTRAINT `campaign_memberships_user_fk` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `ideas` (
  `id` varchar(64) NOT NULL,
  `campaign_id` varchar(64) NOT NULL,
  `submitter_user_id` varchar(64) NOT NULL,
  `title` varchar(255) NOT NULL,
  `original_text` text NOT NULL,
  `source_type` enum('employee_submission','seed_demo') NOT NULL,
  `submitted_at` timestamp NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `ideas_campaign_idx` (`campaign_id`),
  KEY `ideas_submitter_idx` (`submitter_user_id`),
  CONSTRAINT `ideas_campaign_fk` FOREIGN KEY (`campaign_id`) REFERENCES `campaigns` (`id`) ON DELETE CASCADE,
  CONSTRAINT `ideas_submitter_fk` FOREIGN KEY (`submitter_user_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `idea_state_history` (
  `id` varchar(64) NOT NULL,
  `idea_id` varchar(64) NOT NULL,
  `workflow_state` enum('general_idea','needs_employee_clarification','ready_for_rd_review','future_opportunity','inactive_idea','potential_idea') NOT NULL,
  `reason` text,
  `changed_by_user_id` varchar(64),
  `changed_at` timestamp NOT NULL,
  `is_current` tinyint(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (`id`),
  KEY `idea_state_history_idea_idx` (`idea_id`),
  KEY `idea_state_history_changed_by_idx` (`changed_by_user_id`),
  CONSTRAINT `idea_state_history_idea_fk` FOREIGN KEY (`idea_id`) REFERENCES `ideas` (`id`) ON DELETE CASCADE,
  CONSTRAINT `idea_state_history_changed_by_fk` FOREIGN KEY (`changed_by_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `clarification_requests` (
  `id` varchar(64) NOT NULL,
  `idea_id` varchar(64) NOT NULL,
  `request_text` text NOT NULL,
  `status` enum('pending','answered','expired','cancelled') NOT NULL,
  `token_hash` varchar(255) NOT NULL,
  `expires_at` timestamp NOT NULL,
  `answered_at` timestamp NULL,
  `answer_text` text,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `clarification_requests_token_hash_unique` (`token_hash`),
  KEY `clarification_requests_idea_idx` (`idea_id`),
  CONSTRAINT `clarification_requests_idea_fk` FOREIGN KEY (`idea_id`) REFERENCES `ideas` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `ai_decision_logs` (
  `id` varchar(64) NOT NULL,
  `purpose` varchar(128) NOT NULL,
  `model` varchar(128) NOT NULL,
  `status` enum('pending','succeeded','failed','retry_required') NOT NULL,
  `input_reference` text NOT NULL,
  `output_summary` text,
  `raw_response` json,
  `decision_result` json,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `audit_events` (
  `id` varchar(64) NOT NULL,
  `actor_type` enum('user','system','ai') NOT NULL,
  `actor_user_id` varchar(64),
  `event_type` varchar(128) NOT NULL,
  `entity_type` varchar(128) NOT NULL,
  `entity_id` varchar(64) NOT NULL,
  `reason` text,
  `metadata` json,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `audit_events_actor_user_idx` (`actor_user_id`),
  KEY `audit_events_entity_idx` (`entity_type`, `entity_id`),
  CONSTRAINT `audit_events_actor_user_fk` FOREIGN KEY (`actor_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
