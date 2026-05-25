ALTER TABLE `clarification_requests`
  ADD COLUMN `email_status` enum('pending','sent','retry_required') NOT NULL DEFAULT 'pending' AFTER `status`,
  ADD COLUMN `email_tracking_id` varchar(255) AFTER `token_hash`,
  ADD COLUMN `email_error` text AFTER `email_tracking_id`,
  ADD COLUMN `sent_at` timestamp NULL AFTER `email_error`,
  ADD COLUMN `supporting_link` varchar(2048) AFTER `answer_text`,
  ADD COLUMN `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER `created_at`;
