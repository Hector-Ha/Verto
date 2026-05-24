import {
  callStructuredTool,
  LlmInvalidResponseError,
  type LlmProvider,
  type StructuredToolResult
} from "../llm/adapter";

const setupAreas = ["topic", "intent", "review_packet", "rules_memory", "final_review"] as const;
const setupPriorities = ["hard_blocker", "warning", "clarity"] as const;

export type AiSetupQuestion = {
  priority: (typeof setupPriorities)[number];
  questionText: string;
  rationale: string;
  recommendedAnswer: string | null;
  setupArea: (typeof setupAreas)[number];
};

export type CampaignSetupPromptContext = {
  campaign: {
    id: string;
    lifecycleStatus: string;
    publicPrompt: string;
    publicTitle: string;
  };
  latestReportStatus: string | null;
  openQuestions: Array<{
    priority: string;
    questionText: string;
    setupArea: string;
  }>;
  structuredSetup: Array<{
    isContextOverride: boolean;
    isIntentionalAmbiguity: boolean;
    setupArea: string;
    title: string;
    value: string;
  }>;
  warnings: Array<{
    questionText: string;
  }>;
};

export type GenerateAiSetupQuestionResult = StructuredToolResult & {
  parsedQuestion: AiSetupQuestion;
};

const setupQuestionTool = {
  description:
    "Record exactly one focused campaign setup question that should be added to Verto's Agent Question Queue.",
  name: "record_campaign_setup_question",
  parameters: {
    additionalProperties: false,
    properties: {
      priority: {
        description: "Launch impact: hard blockers prevent intake, warnings remain visible, clarity questions are optional.",
        enum: setupPriorities,
        type: "string"
      },
      questionText: {
        description: "One focused question for the R&D Campaign Owner.",
        type: "string"
      },
      rationale: {
        description: "Why this answer matters for AI evaluation ground truth.",
        type: "string"
      },
      recommendedAnswer: {
        description: "Recommended answer when possible; use an empty string only when no default is defensible.",
        type: "string"
      },
      setupArea: {
        description: "Campaign setup area affected by this question.",
        enum: setupAreas,
        type: "string"
      }
    },
    required: ["setupArea", "priority", "questionText", "rationale", "recommendedAnswer"],
    type: "object"
  }
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readRequiredString(value: Record<string, unknown>, key: string, rawResponse: Record<string, unknown>) {
  const candidate = value[key];
  if (typeof candidate !== "string" || !candidate.trim()) {
    throw new LlmInvalidResponseError(`LLM setup question is missing ${key}.`, rawResponse, value);
  }

  return candidate.trim();
}

function readOptionalString(value: Record<string, unknown>, key: string, rawResponse: Record<string, unknown>) {
  const candidate = value[key];
  if (candidate === null || candidate === undefined) {
    return null;
  }

  if (typeof candidate !== "string") {
    throw new LlmInvalidResponseError(`LLM setup question has malformed ${key}.`, rawResponse, value);
  }

  return candidate.trim() || null;
}

function parseSetupArea(value: string, rawResponse: Record<string, unknown>, parsed: Record<string, unknown>) {
  if (!setupAreas.includes(value as AiSetupQuestion["setupArea"])) {
    throw new LlmInvalidResponseError(`LLM setup question used unsupported setupArea: ${value}.`, rawResponse, parsed);
  }

  return value as AiSetupQuestion["setupArea"];
}

function parsePriority(value: string, rawResponse: Record<string, unknown>, parsed: Record<string, unknown>) {
  if (!setupPriorities.includes(value as AiSetupQuestion["priority"])) {
    throw new LlmInvalidResponseError(`LLM setup question used unsupported priority: ${value}.`, rawResponse, parsed);
  }

  return value as AiSetupQuestion["priority"];
}

export function parseAiSetupQuestion(value: unknown, rawResponse: Record<string, unknown>): AiSetupQuestion {
  if (!isRecord(value)) {
    throw new LlmInvalidResponseError("LLM setup question result was not an object.", rawResponse);
  }

  const setupArea = parseSetupArea(readRequiredString(value, "setupArea", rawResponse), rawResponse, value);
  const priority = parsePriority(readRequiredString(value, "priority", rawResponse), rawResponse, value);

  return {
    priority,
    questionText: readRequiredString(value, "questionText", rawResponse),
    rationale: readRequiredString(value, "rationale", rawResponse),
    recommendedAnswer: readOptionalString(value, "recommendedAnswer", rawResponse),
    setupArea
  };
}

function serializePromptContext(context: CampaignSetupPromptContext) {
  return JSON.stringify(
    {
      campaign: context.campaign,
      latestReportStatus: context.latestReportStatus,
      openQuestions: context.openQuestions,
      structuredSetup: context.structuredSetup,
      warnings: context.warnings
    },
    null,
    2
  );
}

export async function generateAiSetupQuestion(
  context: CampaignSetupPromptContext,
  options: {
    model: string;
    provider?: LlmProvider;
  }
): Promise<GenerateAiSetupQuestionResult> {
  const result = await callStructuredTool({
    messages: [
      {
        content: [
          "You are Verto's campaign setup AI.",
          "Use Question Mode: ask one focused question, explain why it matters, recommend a defensible answer when possible.",
          "Do not answer on behalf of R&D. Do not create fallback decisions.",
          "Return only the required structured tool call."
        ].join(" "),
        role: "system"
      },
      {
        content: [
          "Inspect this current campaign setup state and add one useful next setup question.",
          "Avoid duplicating existing open questions or approved decisions.",
          "Prefer launch-impact questions that protect employee intake quality.",
          serializePromptContext(context)
        ].join("\n\n"),
        role: "user"
      }
    ],
    model: options.model,
    provider: options.provider,
    tool: setupQuestionTool
  });

  return {
    ...result,
    parsedQuestion: parseAiSetupQuestion(result.arguments, result.rawResponse)
  };
}
