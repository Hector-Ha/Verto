import { pathToFileURL } from "node:url";

import { createMysqlConnection } from "../db/config";
import {
  BASELINE_TIMESTAMP,
  DEMO_AUDIT_EVENTS,
  DEMO_CAMPAIGN_MEMBERSHIPS,
  DEMO_CAMPAIGNS,
  DEMO_IDEA_STATES,
  DEMO_IDEAS,
  DEMO_KNOWLEDGE_REPORTS,
  DEMO_ROLES,
  DEMO_SETUP_DECISIONS,
  DEMO_SETUP_QUESTIONS,
  DEMO_USER_ROLES,
  DEMO_USERS
} from "./data";

export async function seedDemoData() {
  const connection = await createMysqlConnection();

  try {
    await connection.beginTransaction();

    for (const user of DEMO_USERS) {
      await connection.execute(
        `
          INSERT INTO users (id, email, display_name, department, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            email = VALUES(email),
            display_name = VALUES(display_name),
            department = VALUES(department),
            updated_at = VALUES(updated_at)
        `,
        [user.id, user.email, user.displayName, user.department, BASELINE_TIMESTAMP, BASELINE_TIMESTAMP]
      );
    }

    for (const role of DEMO_ROLES) {
      await connection.execute(
        `
          INSERT INTO roles (id, name, description, created_at)
          VALUES (?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            name = VALUES(name),
            description = VALUES(description)
        `,
        [role.id, role.name, role.description, BASELINE_TIMESTAMP]
      );
    }

    for (const [userId, roleId] of DEMO_USER_ROLES) {
      await connection.execute(
        `
          INSERT INTO user_roles (user_id, role_id, created_at)
          VALUES (?, ?, ?)
          ON DUPLICATE KEY UPDATE created_at = VALUES(created_at)
        `,
        [userId, roleId, BASELINE_TIMESTAMP]
      );
    }

    for (const campaign of DEMO_CAMPAIGNS) {
      await connection.execute(
        `
          INSERT INTO campaigns (
            id,
            type,
            name,
            public_title,
            public_prompt,
            lifecycle_status,
            intake_starts_at,
            intake_ends_at,
            created_by_user_id,
            created_at,
            updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            type = VALUES(type),
            name = VALUES(name),
            public_title = VALUES(public_title),
            public_prompt = VALUES(public_prompt),
            lifecycle_status = VALUES(lifecycle_status),
            intake_starts_at = VALUES(intake_starts_at),
            intake_ends_at = VALUES(intake_ends_at),
            created_by_user_id = VALUES(created_by_user_id),
            updated_at = VALUES(updated_at)
        `,
        [
          campaign.id,
          campaign.type,
          campaign.name,
          campaign.publicTitle,
          campaign.publicPrompt,
          campaign.lifecycleStatus,
          campaign.intakeStartsAt,
          campaign.intakeEndsAt,
          campaign.createdByUserId,
          BASELINE_TIMESTAMP,
          BASELINE_TIMESTAMP
        ]
      );
    }

    for (const [campaignId, userId, membershipRole] of DEMO_CAMPAIGN_MEMBERSHIPS) {
      await connection.execute(
        `
          INSERT INTO campaign_memberships (campaign_id, user_id, membership_role, created_at)
          VALUES (?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE created_at = VALUES(created_at)
        `,
        [campaignId, userId, membershipRole, BASELINE_TIMESTAMP]
      );
    }

    for (const question of DEMO_SETUP_QUESTIONS) {
      await connection.execute(
        `
          INSERT INTO campaign_setup_questions (
            id,
            campaign_id,
            setup_area,
            question_text,
            rationale,
            recommended_answer,
            priority,
            status,
            created_at,
            updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            campaign_id = VALUES(campaign_id),
            setup_area = VALUES(setup_area),
            question_text = VALUES(question_text),
            rationale = VALUES(rationale),
            recommended_answer = VALUES(recommended_answer),
            priority = VALUES(priority),
            status = VALUES(status),
            updated_at = VALUES(updated_at)
        `,
        [
          question.id,
          question.campaignId,
          question.setupArea,
          question.questionText,
          question.rationale,
          question.recommendedAnswer,
          question.priority,
          question.status,
          BASELINE_TIMESTAMP,
          BASELINE_TIMESTAMP
        ]
      );
    }

    for (const decision of DEMO_SETUP_DECISIONS) {
      await connection.execute(
        `
          INSERT INTO campaign_setup_decisions (
            id,
            campaign_id,
            source_answer_id,
            setup_area,
            title,
            value,
            is_intentional_ambiguity,
            is_context_override,
            created_at,
            updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            campaign_id = VALUES(campaign_id),
            source_answer_id = VALUES(source_answer_id),
            setup_area = VALUES(setup_area),
            title = VALUES(title),
            value = VALUES(value),
            is_intentional_ambiguity = VALUES(is_intentional_ambiguity),
            is_context_override = VALUES(is_context_override),
            updated_at = VALUES(updated_at)
        `,
        [
          decision.id,
          decision.campaignId,
          decision.sourceAnswerId,
          decision.setupArea,
          decision.title,
          decision.value,
          decision.isIntentionalAmbiguity,
          decision.isContextOverride,
          BASELINE_TIMESTAMP,
          BASELINE_TIMESTAMP
        ]
      );
    }

    for (const report of DEMO_KNOWLEDGE_REPORTS) {
      await connection.execute(
        `
          INSERT INTO campaign_knowledge_reports (
            id,
            campaign_id,
            html,
            status,
            generated_at,
            approved_by_user_id,
            approved_at,
            created_at,
            updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            campaign_id = VALUES(campaign_id),
            html = VALUES(html),
            status = VALUES(status),
            generated_at = VALUES(generated_at),
            approved_by_user_id = VALUES(approved_by_user_id),
            approved_at = VALUES(approved_at),
            updated_at = VALUES(updated_at)
        `,
        [
          report.id,
          report.campaignId,
          report.html,
          report.status,
          report.generatedAt,
          report.approvedByUserId,
          report.approvedAt,
          BASELINE_TIMESTAMP,
          BASELINE_TIMESTAMP
        ]
      );
    }

    for (const idea of DEMO_IDEAS) {
      await connection.execute(
        `
          INSERT INTO ideas (id, campaign_id, submitter_user_id, title, original_text, source_type, submitted_at, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            campaign_id = VALUES(campaign_id),
            submitter_user_id = VALUES(submitter_user_id),
            title = VALUES(title),
            original_text = VALUES(original_text),
            source_type = VALUES(source_type),
            submitted_at = VALUES(submitted_at)
        `,
        [
          idea.id,
          idea.campaignId,
          idea.submitterUserId,
          idea.title,
          idea.originalText,
          idea.sourceType,
          idea.submittedAt,
          BASELINE_TIMESTAMP
        ]
      );
    }

    for (const ideaState of DEMO_IDEA_STATES) {
      await connection.execute(
        `
          INSERT INTO idea_state_history (id, idea_id, workflow_state, reason, changed_by_user_id, changed_at, is_current)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            idea_id = VALUES(idea_id),
            workflow_state = VALUES(workflow_state),
            reason = VALUES(reason),
            changed_by_user_id = VALUES(changed_by_user_id),
            changed_at = VALUES(changed_at),
            is_current = VALUES(is_current)
        `,
        [
          ideaState.id,
          ideaState.ideaId,
          ideaState.workflowState,
          ideaState.reason,
          ideaState.changedByUserId,
          ideaState.changedAt,
          ideaState.isCurrent
        ]
      );
    }

    for (const event of DEMO_AUDIT_EVENTS) {
      await connection.execute(
        `
          INSERT INTO audit_events (id, actor_type, actor_user_id, event_type, entity_type, entity_id, reason, metadata, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON), ?)
          ON DUPLICATE KEY UPDATE
            actor_type = VALUES(actor_type),
            actor_user_id = VALUES(actor_user_id),
            event_type = VALUES(event_type),
            entity_type = VALUES(entity_type),
            entity_id = VALUES(entity_id),
            reason = VALUES(reason),
            metadata = VALUES(metadata),
            created_at = VALUES(created_at)
        `,
        [
          event.id,
          event.actorType,
          event.actorUserId,
          event.eventType,
          event.entityType,
          event.entityId,
          event.reason,
          event.metadata,
          event.createdAt
        ]
      );
    }

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    await connection.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  seedDemoData()
    .then(() => {
      console.log("seed: demo baseline ready");
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
