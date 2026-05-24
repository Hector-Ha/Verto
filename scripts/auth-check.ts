import assert from "node:assert/strict";

import { DEMO_PERSONAS, type RoleId } from "../src/server/auth/personas";
import {
  canContributeToCampaign,
  canManageCampaignLifecycle,
  canManageGeneralCampaign,
  canManageGeneralCampaignOwnerMembership,
  canSubmitIdea
} from "../src/server/auth/permissions";
import { getSessionCookieOptions } from "../src/server/auth/cookies";
import {
  createSessionToken,
  getSessionFromToken,
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
  verifySessionToken
} from "../src/server/auth/session";
import { closeDatabase } from "../src/server/db/client";
import { runMigrations } from "../src/server/db/migrate";
import { resetAndSeedDemoData } from "../src/server/seed/reset";

type ExpectedPermissions = {
  contributeSpecificCampaign: boolean;
  manageGeneralCampaign: boolean;
  manageGeneralOwners: boolean;
  manageSpecificLifecycle: boolean;
  submitGeneralIdea: boolean;
  submitSpecificOpenCampaign: boolean;
};

const expectedByRole = {
  employee: {
    contributeSpecificCampaign: false,
    manageGeneralCampaign: false,
    manageGeneralOwners: false,
    manageSpecificLifecycle: false,
    submitGeneralIdea: true,
    submitSpecificOpenCampaign: true
  },
  general_campaign_owner: {
    contributeSpecificCampaign: false,
    manageGeneralCampaign: true,
    manageGeneralOwners: false,
    manageSpecificLifecycle: false,
    submitGeneralIdea: false,
    submitSpecificOpenCampaign: false
  },
  rd_manager: {
    contributeSpecificCampaign: true,
    manageGeneralCampaign: true,
    manageGeneralOwners: true,
    manageSpecificLifecycle: true,
    submitGeneralIdea: false,
    submitSpecificOpenCampaign: false
  },
  rd_team_member: {
    contributeSpecificCampaign: true,
    manageGeneralCampaign: false,
    manageGeneralOwners: false,
    manageSpecificLifecycle: false,
    submitGeneralIdea: false,
    submitSpecificOpenCampaign: false
  },
  specific_campaign_owner: {
    contributeSpecificCampaign: true,
    manageGeneralCampaign: false,
    manageGeneralOwners: false,
    manageSpecificLifecycle: true,
    submitGeneralIdea: false,
    submitSpecificOpenCampaign: false
  }
} satisfies Record<RoleId, ExpectedPermissions>;

async function readPermissions(session: NonNullable<Awaited<ReturnType<typeof getSessionFromToken>>>) {
  const [
    manageGeneralOwners,
    manageGeneralCampaign,
    manageSpecificLifecycle,
    contributeSpecificCampaign,
    submitGeneralIdea,
    submitSpecificOpenCampaign
  ] = await Promise.all([
    canManageGeneralCampaignOwnerMembership(session),
    canManageGeneralCampaign(session),
    canManageCampaignLifecycle(session, "specific-campaign"),
    canContributeToCampaign(session, "specific-campaign"),
    canSubmitIdea(session, "general-campaign"),
    canSubmitIdea(session, "specific-campaign")
  ]);

  return {
    contributeSpecificCampaign,
    manageGeneralCampaign,
    manageGeneralOwners,
    manageSpecificLifecycle,
    submitGeneralIdea,
    submitSpecificOpenCampaign
  };
}

async function main() {
  try {
    console.log("auth-check: migrate and reset");
    await runMigrations();
    await resetAndSeedDemoData();

    console.log("auth-check: validate signed session cookie settings");
    const cookieOptions = getSessionCookieOptions("test-token");
    assert.equal(cookieOptions.name, SESSION_COOKIE_NAME);
    assert.equal(cookieOptions.value, "test-token");
    assert.equal(cookieOptions.httpOnly, true);
    assert.equal(cookieOptions.maxAge, SESSION_MAX_AGE_SECONDS);
    assert.equal(cookieOptions.path, "/");
    assert.equal(cookieOptions.sameSite, "lax");

    console.log("auth-check: validate token integrity and expiry");
    const now = new Date("2026-01-15T09:00:00Z");
    const expiresAt = new Date("2026-01-15T10:00:00Z");
    const token = createSessionToken({ roleId: "employee", userId: "employee" }, { expiresAt, now });
    assert.deepEqual(verifySessionToken(token, now), {
      exp: Math.floor(expiresAt.getTime() / 1000),
      roleId: "employee",
      userId: "employee"
    });
    assert.equal(verifySessionToken(`${token.slice(0, -1)}x`, now), null);
    assert.equal(verifySessionToken(token, expiresAt), null);

    console.log("auth-check: validate every demo role permission boundary");
    for (const persona of DEMO_PERSONAS) {
      const personaToken = createSessionToken({ roleId: persona.roleId, userId: persona.userId });
      const session = await getSessionFromToken(personaToken);
      assert(session, `${persona.id} session should resolve from seeded user-role assignment`);
      assert.equal(session.role.id, persona.roleId);
      assert.deepEqual(await readPermissions(session), expectedByRole[persona.roleId], persona.id);
    }

    console.log("auth-check: passed");
  } finally {
    await closeDatabase().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
