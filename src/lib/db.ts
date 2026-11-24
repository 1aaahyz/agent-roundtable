import fs from "node:fs/promises";
import path from "node:path";
import { buildSeed } from "./seed";
import type { Database } from "./types";

const DATA_DIR = path.join(process.cwd(), ".data");
const FILE = path.join(DATA_DIR, "db.json");

let db: Database | null = null;
let loading: Promise<Database> | null = null;
let writeChain: Promise<void> = Promise.resolve();

async function writeNow(): Promise<void> {
  if (!db) return;
  await fs.mkdir(DATA_DIR, { recursive: true });
  const tmp = `${FILE}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(db, null, 2), "utf8");
  await fs.rename(tmp, FILE);
}

function normalize(value: Database): Database {
  const seed = buildSeed();
  for (const key of Object.keys(seed) as Array<keyof Database>) {
    if (key === "settings") {
      value.settings = { ...seed.settings, ...(value.settings ?? {}) };
      continue;
    }
    if ((value[key] as unknown) == null) {
      (value[key] as unknown) = seed[key];
    }
  }
  // Migration: accounts created before the auth upgrade have no passwordHash.
  // Grant them the documented default so the first login still works.
  value.users = (value.users ?? []).map((u) => {
    const needsPassword = typeof (u as { passwordHash?: string }).passwordHash !== "string";
    return needsPassword ? { ...u, passwordHash: seed.users[0].passwordHash } : u;
  });
  return value;
}

export function getDb(): Promise<Database> {
  if (db) return Promise.resolve(db);
  if (loading) return loading;
  loading = (async () => {
    try {
      const raw = await fs.readFile(FILE, "utf8");
      db = normalize(JSON.parse(raw) as Database);
    } catch {
      db = buildSeed();
      await writeNow();
    }
    return db;
  })();
  return loading;
}

/** Serialized writes avoid lost updates under concurrent API calls. */
export function persist(): Promise<void> {
  writeChain = writeChain.then(writeNow, writeNow);
  return writeChain;
}

export async function resetDb(): Promise<Database> {
  db = buildSeed();
  await persist();
  return db;
}
