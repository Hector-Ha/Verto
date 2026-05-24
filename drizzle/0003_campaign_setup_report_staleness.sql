ALTER TABLE `campaign_knowledge_reports`
  MODIFY COLUMN `status` enum('draft','approved','stale') NOT NULL;
