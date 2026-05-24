const DEFAULT_DATABASE_URL = "mysql://verto:verto@127.0.0.1:3307/verto";
const DEFAULT_JWT_SECRET = "verto-local-demo-jwt-secret";

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
