import { LibSQLStore } from "@mastra/libsql";

// Create a single shared LibSQL (SQLite) storage instance
export const sharedPostgresStorage = new LibSQLStore({
  url: "file:mastra.db",
});
