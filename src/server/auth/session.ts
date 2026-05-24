import crypto from "node:crypto";

import { and, eq } from "drizzle-orm";

import { db } from "../db/client";
import { roles, userRoles, users } from "../db/schema";
import { getJwtSecret } from "../env";
import { ROLE_IDS, type RoleId } from "./personas";

export const SESSION_COOKIE_NAME = "verto_demo_session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 8;

export type DemoSession = {
  expiresAt: Date;
  role: {
    id: RoleId;
    name: string;
  };
  user: {
    department: string | null;
    displayName: string;
    email: string;
    id: string;
  };
};

type SessionClaims = {
  exp: number;
  roleId: RoleId;
  userId: string;
};

type CreateSessionOptions = {
  expiresAt?: Date;
  now?: Date;
};

function base64Url(input: Buffer | string) {
  return Buffer.from(input).toString("base64url");
}

function sign(unsignedToken: string) {
  return crypto.createHmac("sha256", getJwtSecret()).update(unsignedToken).digest("base64url");
}

function isRoleId(value: unknown): value is RoleId {
  return typeof value === "string" && ROLE_IDS.includes(value as RoleId);
}

function parseClaims(value: unknown): SessionClaims | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const claims = value as Record<string, unknown>;
  if (typeof claims.userId !== "string" || !isRoleId(claims.roleId) || typeof claims.exp !== "number") {
    return null;
  }

  return {
    exp: claims.exp,
    roleId: claims.roleId,
    userId: claims.userId
  };
}

export function createSessionToken(
  claims: Pick<SessionClaims, "roleId" | "userId">,
  options: CreateSessionOptions = {}
) {
  const now = options.now ?? new Date();
  const expiresAt = options.expiresAt ?? new Date(now.getTime() + SESSION_MAX_AGE_SECONDS * 1000);
  const payload: SessionClaims = {
    ...claims,
    exp: Math.floor(expiresAt.getTime() / 1000)
  };
  const header = {
    alg: "HS256",
    typ: "JWT"
  };
  const unsignedToken = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(payload))}`;

  return `${unsignedToken}.${sign(unsignedToken)}`;
}

export function verifySessionToken(token: string, now = new Date()) {
  const parts = token.split(".");
  if (parts.length !== 3) {
    return null;
  }

  const [header, payload, signature] = parts;
  const unsignedToken = `${header}.${payload}`;
  const expectedSignature = sign(unsignedToken);
  const signatureBuffer = Buffer.from(signature, "base64url");
  const expectedSignatureBuffer = Buffer.from(expectedSignature, "base64url");

  if (
    signatureBuffer.length !== expectedSignatureBuffer.length ||
    !crypto.timingSafeEqual(signatureBuffer, expectedSignatureBuffer)
  ) {
    return null;
  }

  try {
    const claims = parseClaims(JSON.parse(Buffer.from(payload, "base64url").toString("utf8")));
    if (!claims || claims.exp <= Math.floor(now.getTime() / 1000)) {
      return null;
    }

    return claims;
  } catch {
    return null;
  }
}

export async function getSessionFromToken(token: string) {
  const claims = verifySessionToken(token);
  if (!claims) {
    return null;
  }

  const [row] = await db
    .select({
      department: users.department,
      displayName: users.displayName,
      email: users.email,
      roleId: roles.id,
      roleName: roles.name,
      userId: users.id
    })
    .from(userRoles)
    .innerJoin(users, eq(userRoles.userId, users.id))
    .innerJoin(roles, eq(userRoles.roleId, roles.id))
    .where(and(eq(userRoles.userId, claims.userId), eq(userRoles.roleId, claims.roleId)))
    .limit(1);

  if (!row || !isRoleId(row.roleId)) {
    return null;
  }

  return {
    expiresAt: new Date(claims.exp * 1000),
    role: {
      id: row.roleId,
      name: row.roleName
    },
    user: {
      department: row.department,
      displayName: row.displayName,
      email: row.email,
      id: row.userId
    }
  } satisfies DemoSession;
}
