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
    for (const camera of payload.cameras || []) {
      if (!camera.cameraId) continue;
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
  });
  tx();
  return getWorld(worldId);
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
      f.received_at AS lastFrameAt, f.width, f.height, f.fps
    FROM worlds w
    JOIN cameras c ON c.world_id = w.world_id
    LEFT JOIN frames f ON f.world_id = c.world_id AND f.camera_id = c.camera_id
    WHERE w.visibility = 'public' AND c.enabled = 1
    ORDER BY COALESCE(f.received_at, c.last_seen_at) DESC
    LIMIT 200
  `).all();
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
  db.prepare(`
    INSERT INTO frames (world_id, camera_id, image, width, height, fps, captured_at, received_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(world_id, camera_id) DO UPDATE SET
      image = excluded.image,
      width = excluded.width,
      height = excluded.height,
      fps = excluded.fps,
      captured_at = excluded.captured_at,
      received_at = excluded.received_at
  `).run(worldId, cameraId, frame.image, frame.width, frame.height, frame.fps ?? null, capturedAt, now);

  db.prepare("UPDATE cameras SET last_seen_at = ? WHERE world_id = ? AND camera_id = ?").run(now, worldId, cameraId);
  return getFrame(worldId, cameraId);
}

export function getFrame(worldId, cameraId) {
  return db.prepare(`
    SELECT world_id AS worldId, camera_id AS cameraId, image, width, height, fps,
      captured_at AS capturedAt, received_at AS receivedAt
    FROM frames
    WHERE world_id = ? AND camera_id = ?
  `).get(worldId, cameraId);
}
