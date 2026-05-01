import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import Database from "better-sqlite3";
import { normalizeVisibility } from "./lib/access.js";

const databasePath = process.env.DATABASE_PATH || path.join(process.cwd(), "data", "cameras.sqlite");
fs.mkdirSync(path.dirname(databasePath), { recursive: true });

export const db = new Database(databasePath);
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS worlds (
  world_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'private',
  secret TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cameras (
  camera_id TEXT NOT NULL,
  world_id TEXT NOT NULL,
  name TEXT NOT NULL,
  dimension TEXT NOT NULL,
  x INTEGER NOT NULL,
  y INTEGER NOT NULL,
  z INTEGER NOT NULL,
  yaw REAL NOT NULL DEFAULT 0,
  pitch REAL NOT NULL DEFAULT 0,
  fov REAL NOT NULL DEFAULT 70,
  enabled INTEGER NOT NULL DEFAULT 1,
  last_seen_at TEXT,
  PRIMARY KEY (world_id, camera_id),
  FOREIGN KEY (world_id) REFERENCES worlds(world_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS share_codes (
  code_id TEXT PRIMARY KEY,
  world_id TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  revoked_at TEXT,
  FOREIGN KEY (world_id) REFERENCES worlds(world_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS accounts (
  account_id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS world_links (
  world_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  linked_at TEXT NOT NULL,
  PRIMARY KEY (world_id, account_id),
  FOREIGN KEY (world_id) REFERENCES worlds(world_id) ON DELETE CASCADE,
  FOREIGN KEY (account_id) REFERENCES accounts(account_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS link_codes (
  code TEXT PRIMARY KEY,
  world_id TEXT NOT NULL,
  world_secret TEXT NOT NULL,
  created_at TEXT NOT NULL,
  used_at TEXT,
  FOREIGN KEY (world_id) REFERENCES worlds(world_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS control_commands (
  command_id TEXT PRIMARY KEY,
  world_id TEXT NOT NULL,
  camera_id TEXT NOT NULL,
  yaw REAL NOT NULL,
  pitch REAL NOT NULL,
  fov REAL NOT NULL,
  created_at TEXT NOT NULL,
  applied_at TEXT,
  FOREIGN KEY (world_id, camera_id) REFERENCES cameras(world_id, camera_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS frames (
  world_id TEXT NOT NULL,
  camera_id TEXT NOT NULL,
  image TEXT NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  fps REAL,
  captured_at TEXT NOT NULL,
  received_at TEXT NOT NULL,
  PRIMARY KEY (world_id, camera_id),
  FOREIGN KEY (world_id, camera_id) REFERENCES cameras(world_id, camera_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS frames_v2 (
  world_id TEXT NOT NULL,
  camera_id TEXT NOT NULL,
  pov TEXT NOT NULL DEFAULT 'camera',
  image TEXT NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  fps REAL,
  captured_at TEXT NOT NULL,
  received_at TEXT NOT NULL,
  PRIMARY KEY (world_id, camera_id, pov),
  FOREIGN KEY (world_id, camera_id) REFERENCES cameras(world_id, camera_id) ON DELETE CASCADE
);
`);

const upsertWorld = db.prepare(`
INSERT INTO worlds (world_id, name, visibility, secret, updated_at)
VALUES (@worldId, @name, @visibility, @secret, @updatedAt)
ON CONFLICT(world_id) DO UPDATE SET
  name = excluded.name,
  visibility = excluded.visibility,
  secret = excluded.secret,
  updated_at = excluded.updated_at
`);

const upsertCamera = db.prepare(`
INSERT INTO cameras (camera_id, world_id, name, dimension, x, y, z, yaw, pitch, fov, enabled, last_seen_at)
VALUES (@cameraId, @worldId, @name, @dimension, @x, @y, @z, @yaw, @pitch, @fov, @enabled, @lastSeenAt)
ON CONFLICT(world_id, camera_id) DO UPDATE SET
  name = excluded.name,
  dimension = excluded.dimension,
  x = excluded.x,
  y = excluded.y,
  z = excluded.z,
  yaw = excluded.yaw,
  pitch = excluded.pitch,
  fov = excluded.fov,
  enabled = excluded.enabled,
  last_seen_at = excluded.last_seen_at
`);

export function registerWorld(payload) {
  const now = new Date().toISOString();
  const worldId = String(payload.worldId || "").trim();
  if (!worldId) throw new Error("worldId is required");

  const secret = String(payload.secret || crypto.randomBytes(24).toString("base64url"));
  const visibility = normalizeVisibility(payload.visibility);
  const name = String(payload.name || `World ${worldId.slice(0, 8)}`);

  const tx = db.transaction(() => {
    upsertWorld.run({ worldId, name, visibility, secret, updatedAt: now });
    const seenCameraIds = new Set();
    for (const camera of payload.cameras || []) {
      if (!camera.cameraId) continue;
      seenCameraIds.add(String(camera.cameraId));
      upsertCamera.run({
        cameraId: String(camera.cameraId),
        worldId,
        name: String(camera.name || "Camera"),
        dimension: String(camera.dimension || "minecraft:overworld"),
        x: Number.parseInt(camera.x ?? 0, 10),
        y: Number.parseInt(camera.y ?? 0, 10),
        z: Number.parseInt(camera.z ?? 0, 10),
        yaw: Number(camera.yaw ?? 0),
        pitch: Number(camera.pitch ?? 0),
        fov: Number(camera.fov ?? 70),
        enabled: camera.enabled === false ? 0 : 1,
        lastSeenAt: now
      });
    }
    const existing = db.prepare("SELECT camera_id AS cameraId FROM cameras WHERE world_id = ?").all(worldId);
    const removeCamera = db.prepare("DELETE FROM cameras WHERE world_id = ? AND camera_id = ?");
    for (const camera of existing) {
      if (!seenCameraIds.has(camera.cameraId)) {
        removeCamera.run(worldId, camera.cameraId);
      }
    }
  });
  tx();
  return getWorld(worldId);
}

const migrationColumns = [
  ["frames_v2", "pov", "TEXT NOT NULL DEFAULT 'camera'"]
];

for (const [table, column, definition] of migrationColumns) {
  const exists = db.prepare(`PRAGMA table_info(${table})`).all().some((row) => row.name === column);
  if (!exists) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

export function getWorld(worldId) {
  return db.prepare("SELECT world_id AS worldId, name, visibility, secret, updated_at AS updatedAt FROM worlds WHERE world_id = ?").get(worldId);
}

export function setVisibility(worldId, visibility) {
  const normalized = normalizeVisibility(visibility);
  db.prepare("UPDATE worlds SET visibility = ?, updated_at = ? WHERE world_id = ?").run(normalized, new Date().toISOString(), worldId);
  return getWorld(worldId);
}

export function listCameras(worldId) {
  return db.prepare(`
    SELECT camera_id AS cameraId, world_id AS worldId, name, dimension, x, y, z, yaw, pitch, fov,
      enabled = 1 AS enabled, last_seen_at AS lastSeenAt
    FROM cameras
    WHERE world_id = ?
    ORDER BY name COLLATE NOCASE
  `).all(worldId);
}

export function listPublicCameras() {
  return db.prepare(`
    SELECT w.world_id AS worldId, w.name AS worldName, w.visibility,
      c.camera_id AS cameraId, c.name AS cameraName, c.dimension, c.x, c.y, c.z,
      c.enabled = 1 AS enabled, c.last_seen_at AS lastSeenAt,
      f.lastFrameAt, f.width, f.height, f.fps
    FROM worlds w
    JOIN cameras c ON c.world_id = w.world_id
    LEFT JOIN (
      SELECT world_id, camera_id, MAX(received_at) AS lastFrameAt, width, height, fps
      FROM frames_v2
      GROUP BY world_id, camera_id
    ) f ON f.world_id = c.world_id AND f.camera_id = c.camera_id
    WHERE w.visibility = 'public' AND c.enabled = 1
    ORDER BY COALESCE(f.lastFrameAt, c.last_seen_at) DESC
    LIMIT 200
  `).all();
}

export function listPublicWorlds() {
  return db.prepare(`
    SELECT w.world_id AS worldId, w.name AS worldName, w.visibility, w.updated_at AS updatedAt,
      COUNT(c.camera_id) AS cameraCount,
      MAX(f.received_at) AS lastFrameAt,
      MAX(c.last_seen_at) AS lastSeenAt
    FROM worlds w
    LEFT JOIN cameras c ON c.world_id = w.world_id AND c.enabled = 1
    LEFT JOIN frames_v2 f ON f.world_id = c.world_id AND f.camera_id = c.camera_id
    WHERE w.visibility = 'public'
    GROUP BY w.world_id
    ORDER BY COALESCE(MAX(f.received_at), MAX(c.last_seen_at), w.updated_at) DESC
    LIMIT 100
  `).all();
}

export function createLinkCode(worldId, worldSecret) {
  const code = crypto.randomBytes(5).toString("base64url").toUpperCase();
  db.prepare(`
    INSERT INTO link_codes (code, world_id, world_secret, created_at)
    VALUES (?, ?, ?, ?)
  `).run(code, worldId, worldSecret, new Date().toISOString());
  return { code, worldId };
}

export function redeemLinkCode(code, displayName) {
  const normalized = String(code || "").trim().toUpperCase();
  const link = db.prepare(`
    SELECT code, world_id AS worldId, world_secret AS worldSecret
    FROM link_codes
    WHERE code = ? AND used_at IS NULL
  `).get(normalized);
  if (!link) return null;

  const now = new Date().toISOString();
  const account = createAccount(displayName);
  const tx = db.transaction(() => {
    db.prepare("UPDATE link_codes SET used_at = ? WHERE code = ?").run(now, normalized);
    db.prepare(`
      INSERT OR IGNORE INTO world_links (world_id, account_id, linked_at)
      VALUES (?, ?, ?)
    `).run(link.worldId, account.accountId, now);
  });
  tx();
  return { account, worldId: link.worldId };
}

export function getAccountByToken(token) {
  if (!token) return null;
  return db.prepare(`
    SELECT account_id AS accountId, display_name AS displayName, token, created_at AS createdAt
    FROM accounts
    WHERE token = ?
  `).get(token);
}

export function canControlWorld(worldId, token) {
  const account = getAccountByToken(token);
  if (!account) return false;
  const link = db.prepare(`
    SELECT 1 FROM world_links
    WHERE world_id = ? AND account_id = ?
  `).get(worldId, account.accountId);
  return Boolean(link);
}

export function listAccountWorlds(token) {
  const account = getAccountByToken(token);
  if (!account) return [];
  return db.prepare(`
    SELECT w.world_id AS worldId, w.name AS worldName, w.visibility, w.updated_at AS updatedAt,
      COUNT(c.camera_id) AS cameraCount,
      MAX(f.received_at) AS lastFrameAt
    FROM world_links wl
    JOIN worlds w ON w.world_id = wl.world_id
    LEFT JOIN cameras c ON c.world_id = w.world_id
    LEFT JOIN frames_v2 f ON f.world_id = c.world_id AND f.camera_id = c.camera_id
    WHERE wl.account_id = ?
    GROUP BY w.world_id
    ORDER BY w.updated_at DESC
  `).all(account.accountId);
}

export function saveControlCommand(worldId, cameraId, control) {
  const camera = db.prepare("SELECT camera_id AS cameraId FROM cameras WHERE world_id = ? AND camera_id = ?").get(worldId, cameraId);
  if (!camera) return null;
  const yaw = clamp(Number(control.yaw ?? 0), -180, 180);
  const pitch = clamp(Number(control.pitch ?? 0), -90, 90);
  const fov = clamp(Number(control.fov ?? 70), 30, 110);
  const commandId = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  db.prepare(`
    INSERT INTO control_commands (command_id, world_id, camera_id, yaw, pitch, fov, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(commandId, worldId, cameraId, yaw, pitch, fov, createdAt);
  db.prepare(`
    UPDATE cameras SET yaw = ?, pitch = ?, fov = ?, last_seen_at = ?
    WHERE world_id = ? AND camera_id = ?
  `).run(yaw, pitch, fov, createdAt, worldId, cameraId);
  return { commandId, worldId, cameraId, yaw, pitch, fov, createdAt };
}

export function takeControlCommands(worldId) {
  const now = new Date().toISOString();
  const commands = db.prepare(`
    SELECT command_id AS commandId, camera_id AS cameraId, yaw, pitch, fov, created_at AS createdAt
    FROM control_commands
    WHERE world_id = ? AND applied_at IS NULL
    ORDER BY created_at ASC
    LIMIT 50
  `).all(worldId);
  if (commands.length > 0) {
    const mark = db.prepare("UPDATE control_commands SET applied_at = ? WHERE command_id = ?");
    const tx = db.transaction(() => {
      for (const command of commands) mark.run(now, command.commandId);
    });
    tx();
  }
  return commands;
}

export function createShareCode(worldId) {
  const codeId = crypto.randomUUID();
  const code = crypto.randomBytes(12).toString("base64url");
  db.prepare(`
    INSERT INTO share_codes (code_id, world_id, code, created_at)
    VALUES (?, ?, ?, ?)
  `).run(codeId, worldId, code, new Date().toISOString());
  return { codeId, worldId, code };
}

export function revokeShareCode(codeId) {
  const result = db.prepare("UPDATE share_codes SET revoked_at = ? WHERE code_id = ?").run(new Date().toISOString(), codeId);
  return result.changes > 0;
}

export function findShareCodeById(codeId) {
  if (!codeId) return null;
  return db.prepare(`
    SELECT s.code_id AS codeId, s.world_id AS worldId, s.code, s.created_at AS createdAt,
      w.secret AS worldSecret
    FROM share_codes s
    JOIN worlds w ON w.world_id = s.world_id
    WHERE s.code_id = ? AND s.revoked_at IS NULL
  `).get(codeId);
}

export function findShareCode(worldId, code) {
  if (!code) return null;
  return db.prepare(`
    SELECT code_id AS codeId, world_id AS worldId, code, created_at AS createdAt
    FROM share_codes
    WHERE world_id = ? AND code = ? AND revoked_at IS NULL
  `).get(worldId, code);
}

export function saveFrame(worldId, cameraId, frame) {
  const now = new Date().toISOString();
  const capturedAt = frame.capturedAt || now;
  const pov = frame.pov === "player" ? "player" : "camera";
  db.prepare(`
    INSERT INTO frames_v2 (world_id, camera_id, pov, image, width, height, fps, captured_at, received_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(world_id, camera_id, pov) DO UPDATE SET
      image = excluded.image,
      width = excluded.width,
      height = excluded.height,
      fps = excluded.fps,
      captured_at = excluded.captured_at,
      received_at = excluded.received_at
  `).run(worldId, cameraId, pov, frame.image, frame.width, frame.height, frame.fps ?? null, capturedAt, now);

  db.prepare("UPDATE cameras SET last_seen_at = ? WHERE world_id = ? AND camera_id = ?").run(now, worldId, cameraId);
  return getFrame(worldId, cameraId, pov);
}

export function getFrame(worldId, cameraId, pov = "camera") {
  const normalizedPov = pov === "player" ? "player" : "camera";
  return db.prepare(`
    SELECT world_id AS worldId, camera_id AS cameraId, pov, image, width, height, fps,
      captured_at AS capturedAt, received_at AS receivedAt
    FROM frames_v2
    WHERE world_id = ? AND camera_id = ? AND pov = ?
  `).get(worldId, cameraId, normalizedPov);
}

function createAccount(displayName) {
  const now = new Date().toISOString();
  const account = {
    accountId: crypto.randomUUID(),
    displayName: String(displayName || "Minecraft Player").trim().slice(0, 32) || "Minecraft Player",
    token: crypto.randomBytes(32).toString("base64url"),
    createdAt: now
  };
  db.prepare(`
    INSERT INTO accounts (account_id, display_name, token, created_at)
    VALUES (?, ?, ?, ?)
  `).run(account.accountId, account.displayName, account.token, account.createdAt);
  return account;
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}
