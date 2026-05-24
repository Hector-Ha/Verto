import { defineConfig } from "drizzle-kit";

const databaseUrl = process.env.DATABASE_URL ?? "mysql://verto:verto@127.0.0.1:3307/verto";

export default defineConfig({
  schema: "./src/server/db/schema.ts",
  out: "./drizzle",
  dialect: "mysql",
  dbCredentials: {
    url: databaseUrl
  },
  strict: true,
  verbose: true
});
