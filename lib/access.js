export const VISIBILITIES = new Set(["public", "private", "allowed"]);

export function normalizeVisibility(value) {
  return VISIBILITIES.has(value) ? value : "private";
}

export function canViewWorld(world, shareCodeRecord) {
  if (!world) return false;
  if (world.visibility === "public") return true;
  if (world.visibility === "allowed") return Boolean(shareCodeRecord);
  return false;
}

export function normalizePov(value) {
  return value === "player" ? "player" : "camera";
}

export function makeRoom(worldId, cameraId, pov = "camera") {
  return `world:${worldId}:camera:${cameraId}:pov:${normalizePov(pov)}`;
}
