import { getLlmModel, getNvidiaApiKey } from "../env";

const NVIDIA_CHAT_COMPLETIONS_URL = "https://integrate.api.nvidia.com/v1/chat/completions";

type JsonRecord = Record<string, unknown>;

export type LlmMessage = {
  content: string;
  role: "system" | "user" | "assistant" | "tool";
};

export type LlmToolDefinition = {
  description: string;
  name: string;
  parameters: JsonRecord;
};

export type LlmChatCompletionRequest = {
  max_tokens: number;
  messages: LlmMessage[];
  model: string;
  stream: false;
  temperature: number;
  tool_choice: {
    function: {
      name: string;
    };
    type: "function";
  };
  tools: Array<{
    function: LlmToolDefinition;
    type: "function";
  }>;
};

export type LlmProvider = (request: LlmChatCompletionRequest) => Promise<JsonRecord>;

export type StructuredToolResult = {
  arguments: JsonRecord;
  model: string;
  rawResponse: JsonRecord;
  toolName: string;
};

export class LlmProviderError extends Error {
  rawResponse: JsonRecord | null;

  constructor(message: string, rawResponse: JsonRecord | null = null) {
    super(message);
    this.name = "LlmProviderError";
    this.rawResponse = rawResponse;
  }
}

export class LlmInvalidResponseError extends Error {
  parsedResult: JsonRecord | null;
  rawResponse: JsonRecord | null;

  constructor(message: string, rawResponse: JsonRecord | null = null, parsedResult: JsonRecord | null = null) {
    super(message);
    this.name = "LlmInvalidResponseError";
    this.rawResponse = rawResponse;
    this.parsedResult = parsedResult;
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readTextBody(value: string): JsonRecord {
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : { body: value };
  } catch {
    return { body: value };
  }
}

export async function callNvidiaChatCompletions(request: LlmChatCompletionRequest) {
  const response = await fetch(NVIDIA_CHAT_COMPLETIONS_URL, {
    body: JSON.stringify(request),
    headers: {
      accept: "application/json",
      authorization: `Bearer ${getNvidiaApiKey()}`,
      "content-type": "application/json"
    },
    method: "POST"
  });
  const rawResponse = readTextBody(await response.text());

  if (response.status === 202) {
    throw new LlmProviderError("NVIDIA LLM response is pending; retry is required.", rawResponse);
  }

  if (!response.ok) {
    throw new LlmProviderError(`NVIDIA LLM call failed with HTTP ${response.status}.`, rawResponse);
  }

  return rawResponse;
}

function readToolArguments(rawResponse: JsonRecord, toolName: string) {
  const choices = rawResponse.choices;
  if (!Array.isArray(choices) || choices.length === 0 || !isRecord(choices[0])) {
    throw new LlmInvalidResponseError("LLM response did not include choices.", rawResponse);
  }

  const message = choices[0].message;
  if (!isRecord(message)) {
    throw new LlmInvalidResponseError("LLM response choice did not include a message.", rawResponse);
  }

  const toolCalls = message.tool_calls;
  if (!Array.isArray(toolCalls) || toolCalls.length === 0 || !isRecord(toolCalls[0])) {
    throw new LlmInvalidResponseError("LLM response did not include the required tool call.", rawResponse);
  }

  const toolFunction = toolCalls[0].function;
  if (!isRecord(toolFunction) || toolFunction.name !== toolName) {
    throw new LlmInvalidResponseError("LLM response used the wrong structured tool.", rawResponse);
  }

  if (typeof toolFunction.arguments === "string") {
    try {
      const parsed = JSON.parse(toolFunction.arguments) as unknown;
      if (isRecord(parsed)) {
        return parsed;
      }
    } catch {
      throw new LlmInvalidResponseError("LLM tool arguments were not valid JSON.", rawResponse);
    }
  }

  if (isRecord(toolFunction.arguments)) {
    return toolFunction.arguments;
  }

  throw new LlmInvalidResponseError("LLM tool arguments were missing or malformed.", rawResponse);
}

export async function callStructuredTool(input: {
  maxTokens?: number;
  messages: LlmMessage[];
  model?: string;
  provider?: LlmProvider;
  temperature?: number;
  tool: LlmToolDefinition;
}): Promise<StructuredToolResult> {
  const model = input.model ?? getLlmModel();
  const rawResponse = await (input.provider ?? callNvidiaChatCompletions)({
    max_tokens: input.maxTokens ?? 1024,
    messages: input.messages,
    model,
    stream: false,
    temperature: input.temperature ?? 0.1,
    tool_choice: {
      function: {
        name: input.tool.name
      },
      type: "function"
    },
    tools: [
      {
        function: input.tool,
        type: "function"
      }
    ]
  });
  const responseModel = typeof rawResponse.model === "string" ? rawResponse.model : model;

  return {
    arguments: readToolArguments(rawResponse, input.tool.name),
    model: responseModel,
    rawResponse,
    toolName: input.tool.name
  };
}
