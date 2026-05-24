const DEFAULT_DATABASE_URL = "mysql://verto:verto@127.0.0.1:3307/verto";
const DEFAULT_APP_BASE_URL = "http://localhost:3000";
const DEFAULT_CLARIFICATION_LINK_SECRET = "verto-local-demo-clarification-secret";
const DEFAULT_EMAIL_SENDER_ADDRESS = "noreply@hectorha.dev";
const DEFAULT_EMAIL_SENDER_NAME = "Pingram";
const DEFAULT_JWT_SECRET = "verto-local-demo-jwt-secret";
const DEFAULT_LLM_MODEL = "moonshotai/kimi-k2.6";

export function getDatabaseUrl() {
  return process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
}

export function getJwtSecret() {
  const secret = process.env.JWT_SECRET ?? DEFAULT_JWT_SECRET;

  if (process.env.NODE_ENV === "production" && secret === DEFAULT_JWT_SECRET) {
    throw new Error("JWT_SECRET must be set in production.");
  }

  return secret;
}

export function getLlmModel() {
  return process.env.LLM_MODEL ?? process.env.NVIDIA_MODEL ?? DEFAULT_LLM_MODEL;
}

export function getNvidiaApiKey() {
  const apiKey = process.env.NVIDIA_API_KEY ?? process.env.LLM_API_KEY;

  if (!apiKey || apiKey.startsWith("replace-with")) {
    throw new Error("NVIDIA_API_KEY must be set before calling the NVIDIA LLM provider.");
  }

  return apiKey;
}

export function getAppBaseUrl() {
  return process.env.APP_BASE_URL ?? DEFAULT_APP_BASE_URL;
}

export function getClarificationLinkSecret() {
  const secret = process.env.CLARIFICATION_LINK_SECRET ?? DEFAULT_CLARIFICATION_LINK_SECRET;

  if (process.env.NODE_ENV === "production" && secret === DEFAULT_CLARIFICATION_LINK_SECRET) {
    throw new Error("CLARIFICATION_LINK_SECRET must be set in production.");
  }

  return secret;
}

export function getEmailProviderName() {
  return process.env.EMAIL_PROVIDER ?? "pingram";
}

export function getPingramApiKey() {
  const apiKey = process.env.PINGRAM_API_KEY ?? process.env.EMAIL_API_KEY;

  if (!apiKey || apiKey.startsWith("replace-with")) {
    throw new Error("PINGRAM_API_KEY must be set before sending Pingram email.");
  }

  return apiKey;
}

export function getClarificationEmailSender() {
  return {
    email: process.env.EMAIL_SENDER_ADDRESS ?? DEFAULT_EMAIL_SENDER_ADDRESS,
    name: process.env.EMAIL_SENDER_NAME ?? DEFAULT_EMAIL_SENDER_NAME
  };
}
