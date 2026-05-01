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

export function makeRoom(worldId, cameraId) {
  return `world:${worldId}:camera:${cameraId}`;
}

