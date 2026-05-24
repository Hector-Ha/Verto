ALTER TABLE `clarification_requests`
  ADD COLUMN `expired_at` timestamp NULL AFTER `expires_at`,
  ADD COLUMN `assumption_text` text AFTER `expired_at`,
  ADD COLUMN `assumption_reason` text AFTER `assumption_text`,
  ADD COLUMN `assumption_routing_decision` varchar(64) AFTER `assumption_reason`;
