import crypto from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import type { RowDataPacket } from "mysql2/promise";

import { createMysqlConnection } from "./config";

type MigrationRow = RowDataPacket & {
  filename: string;
  checksum: string;
};

const MIGRATIONS_DIR = path.join(process.cwd(), "drizzle");

async function ensureMigrationTable() {
  const connection = await createMysqlConnection({ multipleStatements: true });
  try {
    await connection.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename varchar(255) NOT NULL,
        checksum char(64) NOT NULL,
        applied_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (filename)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
    `);
  } finally {
    await connection.end();
  }
}

function hashSql(sql: string) {
  return crypto.createHash("sha256").update(sql).digest("hex");
}

function checksum(sql: string) {
  return hashSql(sql.replace(/\r\n/g, "\n"));
}

function legacyChecksum(sql: string) {
  return hashSql(sql);
}

export async function runMigrations() {
  await ensureMigrationTable();

  const files = (await readdir(MIGRATIONS_DIR)).filter((file) => file.endsWith(".sql")).sort();
  const connection = await createMysqlConnection({ multipleStatements: true });

  try {
    const [rows] = await connection.query<MigrationRow[]>("SELECT filename, checksum FROM schema_migrations");
    const applied = new Map(rows.map((row) => [row.filename, row.checksum]));

    for (const file of files) {
      const sql = await readFile(path.join(MIGRATIONS_DIR, file), "utf8");
      const fileChecksum = checksum(sql);
      const legacyFileChecksum = legacyChecksum(sql);
      const appliedChecksum = applied.get(file);

      if (appliedChecksum) {
        if (appliedChecksum !== fileChecksum && appliedChecksum !== legacyFileChecksum) {
          throw new Error(`Migration ${file} changed after it was applied.`);
        }
        continue;
      }

      await connection.query(sql);
      await connection.execute("INSERT INTO schema_migrations (filename, checksum) VALUES (?, ?)", [file, fileChecksum]);
      console.log(`migration applied: ${file}`);
    }
  } finally {
    await connection.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runMigrations().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
