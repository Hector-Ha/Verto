import mysql, { type ConnectionOptions, type PoolOptions } from "mysql2/promise";

import { getDatabaseUrl } from "../env";

type DatabaseOptions = {
  multipleStatements?: boolean;
};

function readDatabaseUrl() {
  const databaseUrl = new URL(getDatabaseUrl());
  const database = databaseUrl.pathname.replace(/^\//, "");

  if (!database) {
    throw new Error("DATABASE_URL must include a database name.");
  }

  return {
    database,
    host: databaseUrl.hostname,
    password: decodeURIComponent(databaseUrl.password),
    port: databaseUrl.port ? Number(databaseUrl.port) : 3306,
    user: decodeURIComponent(databaseUrl.username)
  };
}

export function getMysqlPoolOptions(options: DatabaseOptions = {}): PoolOptions {
  return {
    ...readDatabaseUrl(),
    connectionLimit: 10,
    multipleStatements: options.multipleStatements ?? false,
    namedPlaceholders: true,
    waitForConnections: true
  };
}

export function getMysqlConnectionOptions(options: DatabaseOptions = {}): ConnectionOptions {
  return {
    ...readDatabaseUrl(),
    multipleStatements: options.multipleStatements ?? false,
    namedPlaceholders: true
  };
}

export function createMysqlConnection(options: DatabaseOptions = {}) {
  return mysql.createConnection(getMysqlConnectionOptions(options));
}
