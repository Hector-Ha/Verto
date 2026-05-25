ALTER TABLE `users`
  ADD COLUMN `is_active` tinyint(1) NOT NULL DEFAULT 1 AFTER `department`;

ALTER TABLE `clarification_requests`
  ADD COLUMN `campaign_context_id` varchar(64) NULL AFTER `idea_id`,
  ADD KEY `clarification_requests_campaign_context_idx` (`campaign_context_id`),
  ADD CONSTRAINT `clarification_requests_campaign_context_fk`
    FOREIGN KEY (`campaign_context_id`) REFERENCES `campaigns` (`id`) ON DELETE SET NULL;

CREATE TABLE `idea_campaign_associations` (
  `id` varchar(64) NOT NULL,
  `idea_id` varchar(64) NOT NULL,
  `campaign_id` varchar(64) NOT NULL,
  `association_type` enum('submitted','pulled_in') NOT NULL,
  `source_workflow_state` enum(
    'submitted',
    'general_idea',
    'needs_employee_clarification',
    'ready_for_rd_review',
    'future_opportunity',
    'inactive_idea',
    'potential_idea'
  ) NOT NULL,
  `fit_basis` text NOT NULL,
  `routing_basis` text NOT NULL,
  `context_version` varchar(255) NOT NULL,
  `clarification_allowed` tinyint(1) NOT NULL DEFAULT 0,
  `clarification_reason` text NULL,
  `clarification_request_id` varchar(64) NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `idea_campaign_associations_idea_campaign` (`idea_id`, `campaign_id`),
  KEY `idea_campaign_associations_campaign_idx` (`campaign_id`),
  KEY `idea_campaign_associations_clarification_idx` (`clarification_request_id`),
  CONSTRAINT `idea_campaign_associations_idea_fk`
    FOREIGN KEY (`idea_id`) REFERENCES `ideas` (`id`) ON DELETE CASCADE,
  CONSTRAINT `idea_campaign_associations_campaign_fk`
    FOREIGN KEY (`campaign_id`) REFERENCES `campaigns` (`id`) ON DELETE CASCADE,
  CONSTRAINT `idea_campaign_associations_clarification_fk`
    FOREIGN KEY (`clarification_request_id`) REFERENCES `clarification_requests` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT INTO `idea_campaign_associations` (
  `id`,
  `idea_id`,
  `campaign_id`,
  `association_type`,
  `source_workflow_state`,
  `fit_basis`,
  `routing_basis`,
  `context_version`,
  `clarification_allowed`,
  `clarification_reason`,
  `clarification_request_id`,
  `created_at`,
  `updated_at`
)
SELECT
  CONCAT('assoc-', LEFT(SHA2(CONCAT(`ideas`.`id`, ':', `ideas`.`campaign_id`), 256), 56)),
  `ideas`.`id`,
  `ideas`.`campaign_id`,
  'submitted',
  COALESCE(`idea_state_history`.`workflow_state`, 'submitted'),
  'Original employee submission destination.',
  'Existing idea destination backfilled during campaign pull-in migration.',
  'migration-0013',
  0,
  NULL,
  NULL,
  `ideas`.`created_at`,
  `ideas`.`created_at`
FROM `ideas`
LEFT JOIN `idea_state_history`
  ON `idea_state_history`.`idea_id` = `ideas`.`id`
  AND `idea_state_history`.`is_current` = 1;
