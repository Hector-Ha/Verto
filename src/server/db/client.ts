import { drizzle } from "drizzle-orm/mysql2";
import mysql, { type Pool } from "mysql2/promise";

import { getMysqlPoolOptions } from "./config";
import * as schema from "./schema";

const globalForDb = globalThis as typeof globalThis & {
  vertoMysqlPool?: Pool;
};

export const mysqlPool = globalForDb.vertoMysqlPool ?? mysql.createPool(getMysqlPoolOptions());

if (process.env.NODE_ENV !== "production") {
  globalForDb.vertoMysqlPool = mysqlPool;
}

export const db = drizzle(mysqlPool, {
  mode: "default",
  schema
});

export async function pingDatabase() {
  const connection = await mysqlPool.getConnection();
  try {
    await connection.ping();
  } finally {
    connection.release();
  }
}

export async function closeDatabase() {
  await mysqlPool.end();
  globalForDb.vertoMysqlPool = undefined;
}
