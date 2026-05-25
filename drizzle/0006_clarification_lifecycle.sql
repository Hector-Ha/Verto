ALTER TABLE `clarification_requests`
  ADD COLUMN `reminder_sent_at` timestamp NULL AFTER `sent_at`,
  ADD COLUMN `reminder_email_tracking_id` varchar(255) AFTER `reminder_sent_at`;
