const DEFAULT_DATABASE_URL = "mysql://verto:verto@127.0.0.1:3307/verto";
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
