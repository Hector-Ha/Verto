import {
  addCampaignTeamMemberAction,
  changeCampaignLifecycleAction,
  changeCampaignOwnerAction,
  createCampaignAction,
  removeCampaignTeamMemberAction
} from "@/server/campaigns/actions";
import {
  deleteIdeaDraftAction,
  saveIdeaDraftAction,
  submitIdeaAction,
  submitIdeaDraftAction
} from "@/server/employee-intake/actions";
import {
  reclassifyInactiveGeneralIdeaAction,
  updateGeneralCampaignReviewPacketAction
} from "@/server/general-campaign/actions";
import {
  analyzeIdeaFamilyAction,
  regenerateIdeaFamilySummaryAction
} from "@/server/idea-families/actions";
import { requestEmployeeClarificationAction } from "@/server/clarifications/actions";
import {
  answerSetupQuestionAction,
  approveCampaignKnowledgeReportAction,
  approveSetupAnswerAction,
  editPendingSetupAnswerAction,
  generateCampaignKnowledgeReportAction,
  requestAiSetupQuestionAction,
  rejectSetupAnswerAction
} from "@/server/campaign-setup/actions";
import { switchRoleAction } from "@/server/auth/actions";
import { getCurrentSession } from "@/server/auth/cookies";
import {
  assignIdeaRankingAction,
  recordReviewOutcomeAction,
  recommendReviewOutcomeAction
} from "@/server/rd-review/actions";
import {
  getAccessibleRdReviewBoard,
  potentialIdeaReasonTags,
  returnIdeaReasonTags
} from "@/server/rd-review/service";
import { canContributeToCampaign, canRecordReviewOutcome, canRecommendReviewOutcome, getDemoPermissionSummary } from "@/server/auth/permissions";
import { getAuthorizedCampaignSetupView } from "@/server/campaign-setup/service";
import {
  formatClarificationExpiryDate,
  getAccessibleClarificationReviewView,
  getAccessibleClarificationTriggerIdeas
} from "@/server/clarifications/service";
import { getCampaignOperationsView, getDemoRoleSwitchOptions, getDemoSnapshot } from "@/server/db/queries";
import { getEmployeeIntakeView, getEmployeeSubmissionReceipt } from "@/server/employee-intake/service";
import { getGeneralCampaignWorkspaceView } from "@/server/general-campaign/service";
import {
  getAccessibleIdeaFamilyCandidates,
  getAccessibleIdeaFamilyReviewView
} from "@/server/idea-families/service";
import {
  routeIdeaBeforeRdReviewAction,
  runCampaignRoutingRecheckAction,
  runGeneralCampaignRoutingRecheckAction
} from "@/server/pre-rd-routing/actions";
import {
  getAccessibleRoutingCandidateIdeas,
  getAccessibleRoutingReviewView
} from "@/server/pre-rd-routing/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type HomeProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function formatStatus(status: string) {
  return status.replaceAll("_", " ");
}

function formatDateTimeLocal(date: Date | null) {
  return date ? date.toISOString().slice(0, 16) : "";
}

export default async function Home({ searchParams }: HomeProps) {
  const resolvedSearchParams = await searchParams;
  const submittedIdeaId =
    typeof resolvedSearchParams?.submittedIdeaId === "string" ? resolvedSearchParams.submittedIdeaId : null;
  let snapshot: Awaited<ReturnType<typeof getDemoSnapshot>> | null = null;
  let campaignOperations: Awaited<ReturnType<typeof getCampaignOperationsView>> | null = null;
  let setupView: Awaited<ReturnType<typeof getAuthorizedCampaignSetupView>> | null = null;
  let employeeIntakeView: Awaited<ReturnType<typeof getEmployeeIntakeView>> | null = null;
  let generalCampaignWorkspace: Awaited<ReturnType<typeof getGeneralCampaignWorkspaceView>> | null = null;
  let submissionReceipt: Awaited<ReturnType<typeof getEmployeeSubmissionReceipt>> | null = null;
  let clarificationReviewView: Awaited<ReturnType<typeof getAccessibleClarificationReviewView>> = [];
  let clarificationTriggerIdeas: Awaited<ReturnType<typeof getAccessibleClarificationTriggerIdeas>> = [];
  let ideaFamilyCandidates: Awaited<ReturnType<typeof getAccessibleIdeaFamilyCandidates>> = [];
  let ideaFamilyReviewView: Awaited<ReturnType<typeof getAccessibleIdeaFamilyReviewView>> = [];
  let routingCandidateIdeas: Awaited<ReturnType<typeof getAccessibleRoutingCandidateIdeas>> = [];
  let routingReviewView: Awaited<ReturnType<typeof getAccessibleRoutingReviewView>> = [];
  let rdReviewBoard: Awaited<ReturnType<typeof getAccessibleRdReviewBoard>> | null = null;
  let rdReviewPackets: Array<
    Awaited<ReturnType<typeof getAccessibleRdReviewBoard>>["readyPackets"][number] & {
      canRecommend: boolean;
      canRecord: boolean;
    }
  > = [];
  let roleOptions: Awaited<ReturnType<typeof getDemoRoleSwitchOptions>> = [];
  let session: Awaited<ReturnType<typeof getCurrentSession>> = null;
  let permissionSummary: Awaited<ReturnType<typeof getDemoPermissionSummary>> | null = null;
  let databaseError: string | null = null;

  try {
    [snapshot, roleOptions, session] = await Promise.all([
      getDemoSnapshot(),
      getDemoRoleSwitchOptions(),
      getCurrentSession()
    ]);
    if (session) {
      const activeSession = session;
      const [
        nextPermissionSummary,
        nextCampaignOperations,
        canReadSetup,
        nextEmployeeIntakeView,
        nextReceipt,
        nextClarificationReviewView,
        nextClarificationTriggerIdeas,
        nextIdeaFamilyCandidates,
        nextIdeaFamilyReviewView,
        nextRoutingCandidateIdeas,
        nextRoutingReviewView,
        nextRdReviewBoard,
        nextGeneralCampaignWorkspace
      ] = await Promise.all([
        getDemoPermissionSummary(activeSession),
        getCampaignOperationsView(activeSession),
        canContributeToCampaign(activeSession, "setup-campaign"),
        activeSession.role.id === "employee" ? getEmployeeIntakeView(activeSession) : Promise.resolve(null),
        activeSession.role.id === "employee" && submittedIdeaId
          ? getEmployeeSubmissionReceipt(activeSession, submittedIdeaId)
          : Promise.resolve(null),
        getAccessibleClarificationReviewView(activeSession),
        getAccessibleClarificationTriggerIdeas(activeSession),
        getAccessibleIdeaFamilyCandidates(activeSession),
        activeSession.role.id === "employee" ? Promise.resolve([]) : getAccessibleIdeaFamilyReviewView(activeSession),
        getAccessibleRoutingCandidateIdeas(activeSession),
        activeSession.role.id === "employee" ? Promise.resolve([]) : getAccessibleRoutingReviewView(activeSession),
        activeSession.role.id === "employee" ? Promise.resolve(null) : getAccessibleRdReviewBoard(activeSession),
        getGeneralCampaignWorkspaceView(activeSession).catch(() => null)
      ]);

      permissionSummary = nextPermissionSummary;
      campaignOperations = nextCampaignOperations;
      generalCampaignWorkspace = nextGeneralCampaignWorkspace;
      employeeIntakeView = nextEmployeeIntakeView;
      submissionReceipt = nextReceipt;
      clarificationReviewView = nextClarificationReviewView;
      clarificationTriggerIdeas = nextClarificationTriggerIdeas;
      ideaFamilyCandidates = nextIdeaFamilyCandidates;
      ideaFamilyReviewView = nextIdeaFamilyReviewView;
      routingCandidateIdeas = nextRoutingCandidateIdeas;
      routingReviewView = nextRoutingReviewView;
      rdReviewBoard = nextRdReviewBoard;
      if (nextRdReviewBoard) {
        rdReviewPackets = await Promise.all(
          nextRdReviewBoard.readyPackets.map(async (packet) => ({
            ...packet,
            canRecommend: await canRecommendReviewOutcome(activeSession, packet.campaignId),
            canRecord: await canRecordReviewOutcome(activeSession, packet.campaignId)
          }))
        );
      }
      setupView = canReadSetup ? await getAuthorizedCampaignSetupView(activeSession, "setup-campaign") : null;
    }
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

          {generalCampaignWorkspace ? (
            <section className="panel">
              <div className="panel-heading">
                <h2>General Campaign Workspace</h2>
                <span>{generalCampaignWorkspace.readyReviewIdeas.length} ready</span>
              </div>

              <div className="campaign-controls">
                <form action={updateGeneralCampaignReviewPacketAction} className="control-form">
                  <h3>Minimum review packet</h3>
                  <label>
                    <span>Broad packet</span>
                    <textarea
                      defaultValue={generalCampaignWorkspace.currentPacket?.packetText ?? ""}
                      disabled={!generalCampaignWorkspace.canManage}
                      name="packetText"
                      required
                      rows={4}
                    />
                  </label>
                  {generalCampaignWorkspace.currentPacket ? (
                    <code>{generalCampaignWorkspace.currentPacket.contextVersion}</code>
                  ) : null}
                  <button disabled={!generalCampaignWorkspace.canManage} type="submit">Update packet</button>
                </form>

                <div className="table-list">
                  <div className="table-row">
                    <div>
                      <strong>General Ideas</strong>
                      <span>{generalCampaignWorkspace.counts.generalIdeas}</span>
                    </div>
                    <code>intake</code>
                  </div>
                  <div className="table-row">
                    <div>
                      <strong>Awaiting Clarification</strong>
                      <span>{generalCampaignWorkspace.counts.awaitingClarification}</span>
                    </div>
                    <code>separate</code>
                  </div>
                  <div className="table-row">
                    <div>
                      <strong>Future Opportunities</strong>
                      <span>{generalCampaignWorkspace.counts.futureOpportunities}</span>
                    </div>
                    <code>storage</code>
                  </div>
                  <div className="table-row">
                    <div>
                      <strong>Inactive Ideas</strong>
                      <span>{generalCampaignWorkspace.counts.inactiveIdeas}</span>
                    </div>
                    <code>storage</code>
                  </div>
                </div>
              </div>

              <div className="workspace-grid">
                <div className="table-list">
                  <div className="panel-heading">
                    <h3>Ready for Review</h3>
                    <span>{generalCampaignWorkspace.readyReviewIdeas.length}</span>
                  </div>
                  {generalCampaignWorkspace.readyReviewIdeas.map((idea) => (
                    <div className="table-row" key={`general-ready:${idea.ideaId}`}>
                      <div>
                        <strong>{idea.title}</strong>
                        <span>{idea.reason}</span>
                        {idea.evidence ? <span>{idea.evidence}</span> : null}
                      </div>
                      <code>{idea.submitterDisplayName}</code>
                    </div>
                  ))}
                  {generalCampaignWorkspace.readyReviewIdeas.length === 0 ? (
                    <p className="muted-copy">No General Campaign ideas ready for review.</p>
                  ) : null}
                </div>

                <div className="table-list">
                  <div className="panel-heading">
                    <h3>Future Opportunities</h3>
                    <span>{generalCampaignWorkspace.futureOpportunities.length}</span>
                  </div>
                  {generalCampaignWorkspace.futureOpportunities.map((idea) => (
                    <div className="table-row" key={`general-future:${idea.ideaId}`}>
                      <div>
                        <strong>{idea.title}</strong>
                        <span>{idea.reason}</span>
                        {idea.evidence ? <span>{idea.evidence}</span> : null}
                      </div>
                      <code>{idea.submitterDisplayName}</code>
                    </div>
                  ))}
                  {generalCampaignWorkspace.futureOpportunities.length === 0 ? (
                    <p className="muted-copy">No Future Opportunities.</p>
                  ) : null}
                </div>
              </div>

              <div className="table-list">
                <div className="panel-heading">
                  <h3>Inactive Ideas</h3>
                  <span>{generalCampaignWorkspace.inactiveGroups.length} groups</span>
                </div>
                {generalCampaignWorkspace.inactiveGroups.map((group) => (
                  <div className="table-row" key={`inactive-group:${group.reason}`}>
                    <div>
                      <strong>{group.reason}</strong>
                      {group.evidence ? <span>{group.evidence}</span> : null}
                      {group.ideas.map((idea) => (
                        <span key={`inactive-idea:${idea.ideaId}`}>{idea.title}</span>
                      ))}
                    </div>
                    <div className="draft-actions">
                      {group.ideas.map((idea) => (
                        <form action={reclassifyInactiveGeneralIdeaAction} key={`reclassify:${idea.ideaId}`}>
                          <input name="ideaId" type="hidden" value={idea.ideaId} />
                          <select defaultValue="future_opportunity" name="nextState">
                            <option value="future_opportunity">Future Opportunity</option>
                            <option value="ready_for_rd_review">Ready for Review</option>
                            <option value="general_idea">General Idea</option>
                          </select>
                          <input
                            defaultValue="Owner corrected AI classification."
                            name="reason"
                            type="hidden"
                          />
                          <button disabled={!generalCampaignWorkspace.canManage} type="submit">Reclassify</button>
                        </form>
                      ))}
                    </div>
                  </div>
                ))}
                {generalCampaignWorkspace.inactiveGroups.length === 0 ? (
                  <p className="muted-copy">No Inactive Ideas.</p>
                ) : null}
              </div>
            </section>
          ) : null}

          {employeeIntakeView ? (
            <section className="panel intake-panel">
              <div className="panel-heading">
                <h2>Employee Intake</h2>
                <span>{employeeIntakeView.destinations.length} destinations</span>
              </div>
              <div className="intake-shell">
                {submissionReceipt ? (
                  <div className="submission-confirmation">
                    <strong>{submissionReceipt.title}</strong>
                    <span>{submissionReceipt.confirmationText}</span>
                  </div>
                ) : null}

                <div className="intake-grid">
                  <form action={submitIdeaAction} className="control-form">
                    <h3>Submit idea</h3>
                    <label>
                      <span>Destination</span>
                      <select name="campaignId" required>
                        {employeeIntakeView.destinations.map((destination) => (
                          <option key={`submit:${destination.campaignId}`} value={destination.campaignId}>
                            {destination.previewTitle}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span>Title</span>
                      <input name="title" required />
                    </label>
                    <label>
                      <span>Description</span>
                      <textarea name="originalText" required rows={4} />
                    </label>
                    <label>
                      <span>Problem or opportunity</span>
                      <textarea name="problemOpportunity" rows={2} />
                    </label>
                    <label>
                      <span>Expected benefit</span>
                      <textarea name="expectedBenefit" rows={2} />
                    </label>
                    <label>
                      <span>Evidence or example</span>
                      <textarea name="evidenceExample" rows={2} />
                    </label>
                    <label>
                      <span>Supporting link</span>
                      <input name="supportingLink" type="url" />
                    </label>
                    <button type="submit">Submit</button>
                  </form>

                  <form action={saveIdeaDraftAction} className="control-form">
                    <h3>Save draft</h3>
                    <label>
                      <span>Destination</span>
                      <select name="campaignId" required>
                        {employeeIntakeView.destinations.map((destination) => (
                          <option key={`draft:${destination.campaignId}`} value={destination.campaignId}>
                            {destination.previewTitle}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span>Title</span>
                      <input name="title" required />
                    </label>
                    <label>
                      <span>Description</span>
                      <textarea name="originalText" required rows={4} />
                    </label>
                    <label>
                      <span>Problem or opportunity</span>
                      <textarea name="problemOpportunity" rows={2} />
                    </label>
                    <label>
                      <span>Expected benefit</span>
                      <textarea name="expectedBenefit" rows={2} />
                    </label>
                    <label>
                      <span>Evidence or example</span>
                      <textarea name="evidenceExample" rows={2} />
                    </label>
                    <label>
                      <span>Supporting link</span>
                      <input name="supportingLink" type="url" />
                    </label>
                    <button type="submit">Save</button>
                  </form>
                </div>

                <div className="draft-list">
                  {employeeIntakeView.drafts.map((draft) => (
                    <article className="draft-card" key={draft.id}>
                      <div>
                        <strong>{draft.title}</strong>
                        <span>{draft.destinationTitle}</span>
                      </div>
                      <p>{draft.originalText}</p>
                      <div className="draft-actions">
                        <form action={submitIdeaDraftAction}>
                          <input name="draftId" type="hidden" value={draft.id} />
                          <button disabled={!draft.destinationAvailable} type="submit">
                            Submit
                          </button>
                        </form>
                        <form action={deleteIdeaDraftAction}>
                          <input name="draftId" type="hidden" value={draft.id} />
                          <button className="secondary-button" type="submit">
                            Delete
                          </button>
                        </form>
                        {!draft.destinationAvailable ? <code>intake closed</code> : null}
                      </div>
                    </article>
                  ))}
                  {employeeIntakeView.drafts.length === 0 ? <p className="muted-copy">No saved drafts.</p> : null}
                </div>
              </div>
            </section>
          ) : null}

          {session && session.role.id !== "employee" ? (
            <section className="panel">
              <div className="panel-heading">
                <h2>Employee Clarifications</h2>
                <span>{clarificationReviewView.length}</span>
              </div>
              <div className="table-list">
                {clarificationReviewView.map((request) => (
                  <div className="table-row" key={request.requestId}>
                    <div>
                      <strong>{request.ideaTitle}</strong>
                      <span>{request.requestText}</span>
                      <span>Expires {formatClarificationExpiryDate(request.expiresAt)}</span>
                      {request.reminderSentAt ? <span>Reminder sent {request.reminderSentAt.toLocaleString("en-US")}</span> : null}
                      {request.answerText ? <span>{request.answerText}</span> : null}
                      {request.assumptionRoutingDecision ? (
                        <span>
                          Assumption-Based Routing: {formatStatus(request.assumptionRoutingDecision)}.{" "}
                          {request.assumptionText} {request.assumptionReason}
                        </span>
                      ) : null}
                    </div>
                    <code>{formatStatus(request.status)} / {formatStatus(request.emailStatus)}</code>
                  </div>
                ))}
                {clarificationReviewView.length === 0 ? <p className="muted-copy">No employee clarifications yet.</p> : null}
              </div>

              {clarificationTriggerIdeas.length > 0 ? (
                <div className="campaign-control-list">
                  {clarificationTriggerIdeas.map((idea) => (
                    <article className="campaign-control" key={idea.ideaId}>
                      <div className="campaign-control-heading">
                        <div>
                          <h3>{idea.title}</h3>
                          <span>{idea.campaignTitle}</span>
                        </div>
                        <code>{idea.currentWorkflowState ?? "submitted"}</code>
                      </div>
                      <form action={requestEmployeeClarificationAction}>
                        <input name="ideaId" type="hidden" value={idea.ideaId} />
                        <button disabled={idea.hasClarificationBatch} type="submit">
                          Ask AI
                        </button>
                      </form>
                    </article>
                  ))}
                </div>
              ) : null}
            </section>
          ) : null}

          {session && session.role.id !== "employee" && rdReviewBoard ? (
            <section className="panel">
              <div className="panel-heading">
                <h2>R&amp;D Review Board</h2>
                <span>{rdReviewBoard.readyPackets.length} ready</span>
              </div>
              <div className="table-list">
                <div className="table-row">
                  <div>
                    <strong>Lower-priority queues stay separate</strong>
                    <span>Awaiting clarification: {rdReviewBoard.awaitingClarificationCount}</span>
                    <span>Future opportunities: {rdReviewBoard.futureOpportunityCount}</span>
                    <span>Inactive ideas: {rdReviewBoard.inactiveIdeaCount}</span>
                  </div>
                </div>
                {rdReviewPackets.map((packet) => (
                  <div className="table-row" key={packet.ideaId}>
                    <div>
                      <strong>{packet.title}</strong>
                      <span>
                        {packet.campaignTitle} · {packet.submitterDisplayName}
                        {packet.submitterDepartment ? ` · ${packet.submitterDepartment}` : ""}
                      </span>
                      {packet.summary ? <span>{packet.summary.summaryText}</span> : null}
                      {packet.sourceTrace ? (
                        <span>
                          Source trace: {packet.sourceTrace.readinessBasis} ({packet.sourceTrace.routingReason})
                        </span>
                      ) : null}
                      {packet.ranking ? (
                        <span>
                          Rank #{packet.ranking.rankPosition}: {packet.ranking.rankReasons.join(" · ")}
                        </span>
                      ) : null}
                      {packet.members.map((member) => (
                        <span key={`${packet.ideaId}:${member.ideaId}`}>
                          {member.title} · {formatStatus(member.relationshipType)}
                          {member.variantDifference ? ` · ${member.variantDifference}` : ""}
                        </span>
                      ))}
                      {packet.recommendations.map((recommendation) => (
                        <span key={recommendation.recommendationId}>
                          Team recommendation: {formatStatus(recommendation.recommendedOutcome)} · {recommendation.reasonTag}
                          {recommendation.reasonNote ? ` · ${recommendation.reasonNote}` : ""}
                        </span>
                      ))}
                    </div>
                    <div className="draft-actions">
                      {packet.canRecommend ? (
                        <form action={recommendReviewOutcomeAction}>
                          <input name="ideaId" type="hidden" value={packet.ideaId} />
                          <select defaultValue="potential_idea" name="nextState">
                            <option value="potential_idea">Recommend Potential Idea</option>
                            <option value="future_opportunity">Recommend Future Opportunity</option>
                            <option value="inactive_idea">Recommend Inactive Idea</option>
                          </select>
                          <select defaultValue="high_value" name="reasonTag">
                            {[...potentialIdeaReasonTags, ...returnIdeaReasonTags].map((tag) => (
                              <option key={tag} value={tag}>
                                {formatStatus(tag)}
                              </option>
                            ))}
                          </select>
                          <input name="reasonNote" placeholder="Optional note" />
                          <button type="submit">Recommend</button>
                        </form>
                      ) : null}
                      {packet.canRecord ? (
                        <form action={recordReviewOutcomeAction}>
                          <input name="ideaId" type="hidden" value={packet.ideaId} />
                          <select defaultValue="potential_idea" name="nextState">
                            <option value="potential_idea">Mark Potential Idea</option>
                            <option value="future_opportunity">Return Future Opportunity</option>
                            <option value="inactive_idea">Return Inactive Idea</option>
                          </select>
                          <select defaultValue="high_value" name="reasonTag">
                            {[...potentialIdeaReasonTags, ...returnIdeaReasonTags].map((tag) => (
                              <option key={tag} value={tag}>
                                {formatStatus(tag)}
                              </option>
                            ))}
                          </select>
                          <input name="reasonNote" placeholder="Optional note" />
                          <button type="submit">Record outcome</button>
                        </form>
                      ) : null}
                    </div>
                  </div>
                ))}
                {rdReviewBoard.readyPackets.length === 0 ? (
                  <p className="muted-copy">No ideas are Ready for R&amp;D Review.</p>
                ) : null}
              </div>
            </section>
          ) : null}

          {session && session.role.id !== "employee" ? (
            <section className="panel">
              <div className="panel-heading">
                <h2>Idea Families</h2>
                <span>{ideaFamilyReviewView.length} review packets</span>
              </div>

              {ideaFamilyCandidates.length > 0 ? (
                <div className="campaign-control-list">
                  {ideaFamilyCandidates.map((idea) => (
                    <article className="campaign-control" key={`idea-family-candidate:${idea.ideaId}`}>
                      <div className="campaign-control-heading">
                        <div>
                          <h3>{idea.title}</h3>
                          <span>{idea.campaignTitle}</span>
                        </div>
                        <code>ungrouped</code>
                      </div>
                      <form action={analyzeIdeaFamilyAction}>
                        <input name="ideaId" type="hidden" value={idea.ideaId} />
                        <button disabled={!session} type="submit">
                          Analyze family
                        </button>
                      </form>
                    </article>
                  ))}
                </div>
              ) : null}

              <div className="table-list">
                {ideaFamilyReviewView.map((family) => (
                  <div className="table-row" key={family.familyId}>
                    <div>
                      <strong>{family.currentSummary?.summaryText ?? "Summary not generated"}</strong>
                      <span>{family.campaignTitle}</span>
                      {family.currentSummary ? (
                        <span>
                          v{family.currentSummary.version}: {family.currentSummary.aiReason}
                        </span>
                      ) : null}
                      {family.members.map((member) => (
                        <span key={`${family.familyId}:${member.ideaId}`}>
                          {member.title} · {formatStatus(member.relationshipType)} · {member.displayName}
                          {member.variantDifference ? ` · ${member.variantDifference}` : ""}
                        </span>
                      ))}
                    </div>
                    <form action={regenerateIdeaFamilySummaryAction}>
                      <input name="familyId" type="hidden" value={family.familyId} />
                      <button disabled={!session} type="submit">
                        Regenerate
                      </button>
                    </form>
                  </div>
                ))}
                {ideaFamilyReviewView.length === 0 ? <p className="muted-copy">No idea families yet.</p> : null}
              </div>
            </section>
          ) : null}

          {session && session.role.id !== "employee" ? (
            <section className="panel">
              <div className="panel-heading">
                <h2>Pre-R&amp;D Routing</h2>
                <span>{routingReviewView.length} decisions</span>
              </div>
              <div className="campaign-control-list">
                <article className="campaign-control">
                  <div className="campaign-control-heading">
                    <div>
                      <h3>Routing Rechecks</h3>
                      <span>Unreviewed ideas only</span>
                    </div>
                    <code>internal</code>
                  </div>
                  <div className="control-row">
                    <form action={runGeneralCampaignRoutingRecheckAction}>
                      <button disabled={!session || !["rd_manager", "general_campaign_owner"].includes(session.role.id)} type="submit">
                        Recheck General
                      </button>
                    </form>
                    {campaignOperations?.specificCampaigns.map((campaign) => (
                      <form action={runCampaignRoutingRecheckAction} key={`routing-recheck:${campaign.id}`}>
                        <input name="campaignId" type="hidden" value={campaign.id} />
                        <button disabled={!session} type="submit">
                          Recheck {campaign.publicTitle}
                        </button>
                      </form>
                    ))}
                  </div>
                </article>

                {routingCandidateIdeas.map((idea) => (
                  <article className="campaign-control" key={`routing-candidate:${idea.ideaId}`}>
                    <div className="campaign-control-heading">
                      <div>
                        <h3>{idea.title}</h3>
                        <span>{idea.campaignTitle}</span>
                      </div>
                      <code>{formatStatus(idea.currentWorkflowState)}</code>
                    </div>
                    <form action={routeIdeaBeforeRdReviewAction}>
                      <input name="ideaId" type="hidden" value={idea.ideaId} />
                      <button disabled={!session || (idea.campaignType === "general" && !["rd_manager", "general_campaign_owner"].includes(session.role.id))} type="submit">
                        Route with AI
                      </button>
                    </form>
                  </article>
                ))}
              </div>

              <div className="table-list">
                {routingReviewView.map((decision) => (
                  <div className="table-row" key={decision.routingDecisionId}>
                    <div>
                      <strong>{decision.ideaTitle}</strong>
                      <span>
                        {formatStatus(decision.oldWorkflowState)} to {formatStatus(decision.newWorkflowState)}
                      </span>
                      <span>{decision.newReason}</span>
                      <span>Readiness gate: {decision.readinessBasis}</span>
                      {decision.outOfScopeMatched ? <span>Out of scope: {decision.outOfScopeReason}</span> : null}
                      <span>Context {decision.contextVersion}</span>
                    </div>
                    <code>{formatStatus(decision.trigger)}</code>
                  </div>
                ))}
                {routingReviewView.length === 0 ? <p className="muted-copy">No routing decisions yet.</p> : null}
              </div>
            </section>
          ) : null}

          {campaignOperations ? (
            <section className="panel">
              <div className="panel-heading">
                <h2>Campaign Controls</h2>
                <span>{session?.role.name ?? "no session"}</span>
              </div>
              <div className="campaign-controls">
                <form action={createCampaignAction} className="control-form">
                  <h3>Create specific campaign</h3>
                  <label>
                    <span>Name</span>
                    <input defaultValue="New Materials Campaign" disabled={!session} name="name" required />
                  </label>
                  <label>
                    <span>Public title</span>
                    <input defaultValue="New Materials Ideas" disabled={!session} name="publicTitle" required />
                  </label>
                  <label>
                    <span>Public prompt</span>
                    <textarea
                      defaultValue="Share practical ideas for reusable materials in production workflows."
                      disabled={!session}
                      name="publicPrompt"
                      required
                      rows={3}
                    />
                  </label>
                  <label>
                    <span>Owner</span>
                    <select defaultValue={session?.role.id === "specific_campaign_owner" ? session.user.id : "rd-manager"} disabled={!session} name="ownerUserId" required>
                      {campaignOperations.ownerOptions.map((option) => (
                        <option key={`${option.userId}:${option.roleId}`} value={option.userId}>
                          {option.displayName}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button disabled={!session} type="submit">
                    Create
                  </button>
                </form>

                <div className="campaign-control-list">
                  {campaignOperations.specificCampaigns.map((campaign) => {
                    const teamMembers = campaign.memberships.filter((membership) => membership.membershipRole === "member");

                    return (
                    <article className="campaign-control" key={campaign.id}>
                      <div className="campaign-control-heading">
                        <div>
                          <h3>{campaign.publicTitle}</h3>
                          <span>{campaign.name}</span>
                        </div>
                        <code>{campaign.lifecycleStatus}</code>
                      </div>

                      <div className="campaign-member-list">
                        {campaign.memberships.map((membership) => (
                          <span key={`${membership.userId}:${membership.membershipRole}`}>
                            {membership.displayName} · {membership.membershipRole}
                          </span>
                        ))}
                      </div>

                      <div className="control-row">
                        <form action={changeCampaignOwnerAction} className="inline-form">
                          <input name="campaignId" type="hidden" value={campaign.id} />
                          <select disabled={!session} name="ownerUserId" required>
                            {campaignOperations.ownerOptions.map((option) => (
                              <option key={`${campaign.id}:owner:${option.userId}:${option.roleId}`} value={option.userId}>
                                {option.displayName}
                              </option>
                            ))}
                          </select>
                          <button disabled={!session} type="submit">
                            Set owner
                          </button>
                        </form>

                        <form action={addCampaignTeamMemberAction} className="inline-form">
                          <input name="campaignId" type="hidden" value={campaign.id} />
                          <select disabled={!session} name="userId" required>
                            {campaignOperations.teamMemberOptions.map((option) => (
                              <option key={`${campaign.id}:member:${option.userId}`} value={option.userId}>
                                {option.displayName}
                              </option>
                            ))}
                          </select>
                          <button disabled={!session} type="submit">
                            Add member
                          </button>
                        </form>

                        <form action={removeCampaignTeamMemberAction} className="inline-form">
                          <input name="campaignId" type="hidden" value={campaign.id} />
                          <select disabled={!session || teamMembers.length === 0} name="userId" required>
                            {teamMembers
                              .map((membership) => (
                                <option key={`${campaign.id}:remove:${membership.userId}`} value={membership.userId}>
                                  {membership.displayName}
                                </option>
                              ))}
                          </select>
                          <button disabled={!session || teamMembers.length === 0} type="submit">
                            Remove member
                          </button>
                        </form>
                      </div>

                      <form action={changeCampaignLifecycleAction} className="lifecycle-form">
                        <input name="campaignId" type="hidden" value={campaign.id} />
                        <label>
                          <span>Next gate</span>
                          <select disabled={!session || campaign.nextStatuses.length === 0} name="nextStatus" required>
                            {campaign.nextStatuses.map((status) => (
                              <option key={`${campaign.id}:${status}`} value={status}>
                                {formatStatus(status)}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          <span>Starts</span>
                          <input defaultValue={formatDateTimeLocal(campaign.intakeStartsAt)} disabled={!session} name="intakeStartsAt" type="datetime-local" />
                        </label>
                        <label>
                          <span>Ends</span>
                          <input defaultValue={formatDateTimeLocal(campaign.intakeEndsAt)} disabled={!session} name="intakeEndsAt" type="datetime-local" />
                        </label>
                        <button disabled={!session || campaign.nextStatuses.length === 0} type="submit">
                          Move gate
                        </button>
                      </form>
                    </article>
                    );
                  })}
                </div>
              </div>
            </section>
          ) : null}

          {setupView ? (
            <section className="panel setup-panel">
              <div className="panel-heading">
                <h2>Campaign Setup</h2>
                <span>{setupView.openHardBlockerCount} blockers</span>
              </div>
              <div className="setup-shell">
                <div className="setup-summary">
                  <div>
                    <h3>{setupView.campaign.publicTitle}</h3>
                    <span>{formatStatus(setupView.campaign.lifecycleStatus)}</span>
                  </div>
                  <div>
                    <strong>{setupView.latestReport?.status ?? "no report"}</strong>
                    <span>Knowledge Report</span>
                  </div>
                  <div>
                    <strong>{setupView.pendingOwnerApprovals.length}</strong>
                    <span>Pending owner approval</span>
                  </div>
                  <div>
                    <strong>{setupView.warnings.length}</strong>
                    <span>Warnings</span>
                  </div>
                  <div>
                    <strong>{setupView.aiRetryStates.length}</strong>
                    <span>AI retry states</span>
                  </div>
                </div>

                <div className="setup-grid">
                  <div className="setup-column">
                    <div className="setup-column-heading">
                      <h3>Agent Question Queue</h3>
                      <form action={requestAiSetupQuestionAction}>
                        <input name="campaignId" type="hidden" value={setupView.campaign.id} />
                        <button disabled={!session || !setupView.canManageSetup} type="submit">
                          Ask AI
                        </button>
                      </form>
                    </div>
                    {setupView.questionQueue.map((question) => (
                      <article className="setup-item" key={question.id}>
                        <div className="setup-item-heading">
                          <code>{question.priority}</code>
                          <span>{formatStatus(question.setupArea)}</span>
                        </div>
                        <strong>{question.questionText}</strong>
                        <p>{question.rationale}</p>
                        {question.recommendedAnswer ? <p>{question.recommendedAnswer}</p> : null}
                        <form action={answerSetupQuestionAction} className="setup-answer-form">
                          <input name="questionId" type="hidden" value={question.id} />
                          <label>
                            <span>Decision title</span>
                            <input defaultValue={formatStatus(question.setupArea)} disabled={!session} name="decisionTitle" required />
                          </label>
                          <label>
                            <span>Answer</span>
                            <textarea defaultValue={question.recommendedAnswer ?? ""} disabled={!session} name="answerText" required rows={3} />
                          </label>
                          <label className="checkbox-line">
                            <input disabled={!session} name="isIntentionalAmbiguity" type="checkbox" />
                            <span>Record intentional ambiguity</span>
                          </label>
                          <label className="checkbox-line">
                            <input disabled={!session} name="isContextOverride" type="checkbox" />
                            <span>Record campaign context override</span>
                          </label>
                          <button disabled={!session} type="submit">
                            Answer
                          </button>
                        </form>
                      </article>
                    ))}
                  </div>

                  <div className="setup-column">
                    <h3>Owner Attention Queue</h3>
                    {setupView.aiRetryStates.length === 0 && setupView.pendingOwnerApprovals.length === 0 ? (
                      <p className="muted-copy">No pending owner approvals.</p>
                    ) : null}
                    {setupView.aiRetryStates.map((retryState) => (
                      <article className="setup-item setup-item--retry" key={retryState.id}>
                        <div className="setup-item-heading">
                          <code>retry_required</code>
                          <span>{retryState.model}</span>
                        </div>
                        <strong>AI setup question retry required</strong>
                        <p>{retryState.outputSummary ?? "Retry the AI setup question request before this setup step can continue."}</p>
                      </article>
                    ))}
                    {setupView.pendingOwnerApprovals.map((answer) => (
                      <article className="setup-item" key={answer.id}>
                        <div className="setup-item-heading">
                          <code>pending</code>
                          <span>{formatStatus(answer.setupArea)}</span>
                        </div>
                        <strong>{answer.decisionTitle}</strong>
                        <form action={editPendingSetupAnswerAction} className="setup-answer-form">
                          <input name="answerId" type="hidden" value={answer.id} />
                          <label>
                            <span>Owner edit</span>
                            <textarea defaultValue={answer.answerText} disabled={!session} name="answerText" required rows={3} />
                          </label>
                          <button disabled={!session} type="submit">
                            Save edit
                          </button>
                        </form>
                        <div className="approval-row">
                          <form action={approveSetupAnswerAction}>
                            <input name="answerId" type="hidden" value={answer.id} />
                            <button disabled={!session} type="submit">
                              Approve
                            </button>
                          </form>
                          <form action={rejectSetupAnswerAction}>
                            <input name="answerId" type="hidden" value={answer.id} />
                            <input defaultValue="Owner rejected for launch." name="reason" type="hidden" />
                            <button disabled={!session} type="submit">
                              Reject
                            </button>
                          </form>
                        </div>
                      </article>
                    ))}

                    <h3>Structured Setup View</h3>
                    <div className="decision-list">
                      {setupView.structuredSetup.map((decision) => (
                        <div className="decision" key={decision.id}>
                          <strong>{decision.title}</strong>
                          <span>{decision.value}</span>
                          <div>
                            {decision.isIntentionalAmbiguity ? <code>intentional ambiguity</code> : null}
                            {decision.isContextOverride ? <code>context override</code> : null}
                          </div>
                        </div>
                      ))}
                      {setupView.structuredSetup.length === 0 ? <p className="muted-copy">No approved setup decisions yet.</p> : null}
                    </div>
                  </div>
                </div>

                <div className="knowledge-report">
                  <div className="campaign-control-heading">
                    <div>
                      <h3>Campaign Knowledge Report</h3>
                      <span>{setupView.latestReport ? `${setupView.latestReport.status} report` : "No report generated"}</span>
                    </div>
                    <div className="approval-row">
                      <form action={generateCampaignKnowledgeReportAction}>
                        <input name="campaignId" type="hidden" value={setupView.campaign.id} />
                        <button disabled={!session || !setupView.canManageSetup || setupView.aiRetryStates.length > 0} type="submit">
                          Generate report
                        </button>
                      </form>
                      {setupView.latestReport?.status === "draft" ? (
                        <form action={approveCampaignKnowledgeReportAction}>
                          <input name="reportId" type="hidden" value={setupView.latestReport.id} />
                          <button
                            disabled={
                              !session ||
                              !setupView.canManageSetup ||
                              setupView.openHardBlockerCount > 0 ||
                              setupView.aiRetryStates.length > 0
                            }
                            type="submit"
                          >
                            Approve report
                          </button>
                        </form>
                      ) : null}
                    </div>
                  </div>
                  {setupView.latestReport ? <div className="report-preview" dangerouslySetInnerHTML={{ __html: setupView.latestReport.html }} /> : null}
                </div>
              </div>
            </section>
          ) : null}
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
