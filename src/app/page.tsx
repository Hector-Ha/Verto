import { switchRoleAction } from "@/server/auth/actions";
import { getCurrentSession } from "@/server/auth/cookies";
import { getDemoPermissionSummary } from "@/server/auth/permissions";
import { getDemoSnapshot } from "@/server/db/queries";
import { getDemoRoleSwitchOptions } from "@/server/db/queries";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function Home() {
  let snapshot: Awaited<ReturnType<typeof getDemoSnapshot>> | null = null;
  let roleOptions: Awaited<ReturnType<typeof getDemoRoleSwitchOptions>> = [];
  let session: Awaited<ReturnType<typeof getCurrentSession>> = null;
  let permissionSummary: Awaited<ReturnType<typeof getDemoPermissionSummary>> | null = null;
  let databaseError: string | null = null;

  try {
    [snapshot, roleOptions, session] = await Promise.all([getDemoSnapshot(), getDemoRoleSwitchOptions(), getCurrentSession()]);
    permissionSummary = session ? await getDemoPermissionSummary(session) : null;
  } catch (error) {
    databaseError = error instanceof Error ? error.message : "Unknown database error";
  }

  return (
    <main className="shell">
      <section className="hero-band">
        <div>
          <p className="eyebrow">Verto</p>
          <h1>Verto demo baseline</h1>
          <p className="lede">Local MVP foundation for campaign intake, role authority, workflow state, and audit truth.</p>
        </div>
        <div className="status-panel" aria-label="database status">
          <span className={snapshot ? "status-dot status-dot--ok" : "status-dot status-dot--down"} />
          <span>{snapshot ? "Database connected" : "Database unavailable"}</span>
        </div>
      </section>

      {snapshot ? (
        <>
          <section className="workspace-grid">
            <div className="panel role-panel">
              <div className="panel-heading">
                <h2>Active Demo Role</h2>
                <span>{session ? "signed session" : "no session"}</span>
              </div>
              <div className="active-role">
                <div>
                  <strong>{session?.user.displayName ?? "No active role"}</strong>
                  <span>{session?.user.email ?? "Select a seeded demo role"}</span>
                </div>
                <code>{session?.role.name ?? "none"}</code>
              </div>
              {session ? <p className="session-expiry">Expires {session.expiresAt.toLocaleString("en-US")}</p> : null}
            </div>

            <div className="panel">
              <div className="panel-heading">
                <h2>Role Switcher</h2>
                <span>{roleOptions.length}</span>
              </div>
              <div className="role-grid">
                {roleOptions.map((option) => {
                  const isActive = session?.user.id === option.userId && session.role.id === option.roleId;

                  return (
                    <form action={switchRoleAction} key={option.personaId}>
                      <input name="personaId" type="hidden" value={option.personaId} />
                      <button
                        aria-label={`${option.label} ${option.displayName}`}
                        aria-pressed={isActive}
                        className="role-button"
                        disabled={isActive}
                        type="submit"
                      >
                        <strong>{option.label}</strong>
                        <span>{option.displayName}</span>
                      </button>
                    </form>
                  );
                })}
              </div>
            </div>
          </section>

          {permissionSummary ? (
            <section className="panel">
              <div className="panel-heading">
                <h2>Permission Boundary</h2>
                <span>{session?.role.name}</span>
              </div>
              <div className="permission-grid">
                <div className={permissionSummary.manageGeneralOwners ? "permission permission--allowed" : "permission"}>
                  <span>Manage general owners</span>
                  <strong>{permissionSummary.manageGeneralOwners ? "Allowed" : "Denied"}</strong>
                </div>
                <div className={permissionSummary.manageGeneralCampaign ? "permission permission--allowed" : "permission"}>
                  <span>Manage General Campaign</span>
                  <strong>{permissionSummary.manageGeneralCampaign ? "Allowed" : "Denied"}</strong>
                </div>
                <div className={permissionSummary.manageSpecificLifecycle ? "permission permission--allowed" : "permission"}>
                  <span>Manage specific lifecycle</span>
                  <strong>{permissionSummary.manageSpecificLifecycle ? "Allowed" : "Denied"}</strong>
                </div>
                <div className={permissionSummary.contributeSpecificCampaign ? "permission permission--allowed" : "permission"}>
                  <span>Contribute to specific campaign</span>
                  <strong>{permissionSummary.contributeSpecificCampaign ? "Allowed" : "Denied"}</strong>
                </div>
                <div className={permissionSummary.submitGeneralIdea ? "permission permission--allowed" : "permission"}>
                  <span>Submit General Campaign idea</span>
                  <strong>{permissionSummary.submitGeneralIdea ? "Allowed" : "Denied"}</strong>
                </div>
              </div>
            </section>
          ) : null}

          <section className="metrics-grid" aria-label="demo baseline counts">
            <div className="metric">
              <span>Users</span>
              <strong>{snapshot.userCount}</strong>
            </div>
            <div className="metric">
              <span>Roles</span>
              <strong>{snapshot.roleCount}</strong>
            </div>
            <div className="metric">
              <span>Campaigns</span>
              <strong>{snapshot.campaignCount}</strong>
            </div>
            <div className="metric">
              <span>Ideas</span>
              <strong>{snapshot.ideaCount}</strong>
            </div>
          </section>

          <section className="workspace-grid">
            <div className="panel">
              <div className="panel-heading">
                <h2>Campaigns</h2>
                <span>{snapshot.campaigns.length}</span>
              </div>
              <div className="table-list">
                {snapshot.campaigns.map((campaign) => (
                  <div className="table-row" key={campaign.id}>
                    <div>
                      <strong>{campaign.publicTitle}</strong>
                      <span>{campaign.name}</span>
                    </div>
                    <code>{campaign.lifecycleStatus}</code>
                  </div>
                ))}
              </div>
            </div>

            <div className="panel">
              <div className="panel-heading">
                <h2>Seeded People</h2>
                <span>{snapshot.users.length}</span>
              </div>
              <div className="table-list">
                {snapshot.users.map((user) => (
                  <div className="table-row" key={user.id}>
                    <div>
                      <strong>{user.displayName}</strong>
                      <span>{user.email}</span>
                    </div>
                    <span>{user.department}</span>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className="panel">
            <div className="panel-heading">
              <h2>General Ideas</h2>
              <span>{snapshot.generalIdeas.length}</span>
            </div>
            <div className="table-list">
              {snapshot.generalIdeas.map((idea) => (
                <div className="table-row" key={idea.id}>
                  <div>
                    <strong>{idea.title}</strong>
                    <span>{idea.id}</span>
                  </div>
                  <code>general_idea</code>
                </div>
              ))}
            </div>
          </section>
        </>
      ) : (
        <section className="panel panel--error">
          <h2>Database unavailable</h2>
          <p>{databaseError}</p>
        </section>
      )}
    </main>
  );
}
