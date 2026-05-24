import { submitClarificationAnswerAction } from "@/server/clarifications/actions";
import { getEmployeeClarificationView } from "@/server/clarifications/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type ClarificationPageProps = {
  params: Promise<{
    token: string;
  }>;
};

export default async function ClarificationPage({ params }: ClarificationPageProps) {
  const { token } = await params;
  const view = await getEmployeeClarificationView(token);

  return (
    <main className="shell">
      <section className="hero-band">
        <div>
          <p className="eyebrow">Verto</p>
          <h1>Idea clarification</h1>
          <p className="lede">Add one detail to help R&D understand your submitted idea.</p>
        </div>
      </section>

      <section className="panel intake-panel">
        {!view ? (
          <>
            <div className="panel-heading">
              <h2>Link unavailable</h2>
              <span>closed</span>
            </div>
            <p className="muted-copy">This clarification link is not available.</p>
          </>
        ) : (
          <>
            <div className="panel-heading">
              <h2>{view.ideaTitle}</h2>
              <span>{view.campaignTitle}</span>
            </div>
            <div className="submission-confirmation">
              <strong>{view.requestText}</strong>
              <span>Expires {view.expiresAt.toLocaleDateString("en-US")}</span>
            </div>
            <p>{view.campaignPrompt}</p>
            <p>{view.originalText}</p>

            {view.answered ? (
              <div className="submission-confirmation">
                <strong>Answer received</strong>
                {view.supportingLink ? <span>{view.supportingLink}</span> : null}
              </div>
            ) : null}

            {view.expired && !view.answered ? (
              <p className="muted-copy">This clarification link has expired.</p>
            ) : null}

            {view.canAnswer ? (
              <form action={submitClarificationAnswerAction} className="control-form">
                <input name="token" type="hidden" value={token} />
                <label>
                  <span>Answer</span>
                  <textarea name="answerText" required rows={5} />
                </label>
                <label>
                  <span>Supporting link</span>
                  <input name="supportingLink" type="url" />
                </label>
                <button type="submit">Submit answer</button>
              </form>
            ) : null}
          </>
        )}
      </section>
    </main>
  );
}
