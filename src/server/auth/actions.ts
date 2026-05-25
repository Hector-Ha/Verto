"use server";

import { redirect } from "next/navigation";

import { getDemoRoleSwitchOptionById } from "../db/queries";
import { setSessionCookie } from "./cookies";
import { createSessionToken } from "./session";

export async function switchRoleAction(formData: FormData) {
  const personaId = formData.get("personaId");
  if (typeof personaId !== "string") {
    throw new Error("Missing demo persona.");
  }

  const option = await getDemoRoleSwitchOptionById(personaId);
  if (!option) {
    throw new Error("Unknown demo persona.");
  }

  const token = createSessionToken({
    roleId: option.roleId,
    userId: option.userId
  });

  await setSessionCookie(token);
  redirect("/");
}
