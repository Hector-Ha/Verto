ALTER TABLE `campaigns`
  ADD COLUMN `public_examples` text AFTER `public_prompt`,
  ADD COLUMN `preview_version` int NOT NULL DEFAULT 1 AFTER `public_examples`;

ALTER TABLE `ideas`
  ADD COLUMN `problem_opportunity` text AFTER `original_text`,
  ADD COLUMN `expected_benefit` text AFTER `problem_opportunity`,
  ADD COLUMN `evidence_example` text AFTER `expected_benefit`,
  ADD COLUMN `supporting_link` varchar(2048) AFTER `evidence_example`,
  ADD COLUMN `preview_version` int NOT NULL DEFAULT 1 AFTER `supporting_link`,
  ADD COLUMN `preview_title` varchar(255) NOT NULL DEFAULT '' AFTER `preview_version`,
  ADD COLUMN `preview_prompt` text AFTER `preview_title`,
  ADD COLUMN `preview_examples` text AFTER `preview_prompt`;

UPDATE `ideas`
INNER JOIN `campaigns` ON `campaigns`.`id` = `ideas`.`campaign_id`
SET
  `ideas`.`preview_version` = `campaigns`.`preview_version`,
  `ideas`.`preview_title` = `campaigns`.`public_title`,
  `ideas`.`preview_prompt` = `campaigns`.`public_prompt`,
  `ideas`.`preview_examples` = `campaigns`.`public_examples`
WHERE `ideas`.`preview_title` = '';

ALTER TABLE `idea_state_history`
  MODIFY COLUMN `workflow_state` enum(
    'submitted',
    'general_idea',
    'needs_employee_clarification',
    'ready_for_rd_review',
    'future_opportunity',
    'inactive_idea',
    'potential_idea'
  ) NOT NULL;

CREATE TABLE `idea_drafts` (
  `id` varchar(64) NOT NULL,
  `owner_user_id` varchar(64) NOT NULL,
  `campaign_id` varchar(64) NOT NULL,
  `title` varchar(255) NOT NULL,
  `original_text` text NOT NULL,
  `problem_opportunity` text,
  `expected_benefit` text,
  `evidence_example` text,
  `supporting_link` varchar(2048),
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idea_drafts_owner_idx` (`owner_user_id`),
  KEY `idea_drafts_campaign_idx` (`campaign_id`),
  CONSTRAINT `idea_drafts_owner_fk` FOREIGN KEY (`owner_user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `idea_drafts_campaign_fk` FOREIGN KEY (`campaign_id`) REFERENCES `campaigns` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
