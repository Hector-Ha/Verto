import { cookies } from "next/headers";

import { getSessionFromToken, SESSION_COOKIE_NAME, SESSION_MAX_AGE_SECONDS } from "./session";

export function getSessionCookieOptions(token: string) {
  return {
    httpOnly: true,
    maxAge: SESSION_MAX_AGE_SECONDS,
    name: SESSION_COOKIE_NAME,
    path: "/",
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    value: token
  };
}

export async function getCurrentSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  return token ? getSessionFromToken(token) : null;
}

export async function setSessionCookie(token: string) {
  const cookieStore = await cookies();

  cookieStore.set(getSessionCookieOptions(token));
}
