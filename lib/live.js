const sessions = new Map();

export function startLiveSession(worldId, cameraId, pov, options = {}) {
  const key = makeKey(worldId, cameraId, pov);
  const existing = sessions.get(key);
  const session = {
    worldId,
    cameraId,
    pov,
    startedAt: existing?.startedAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    codec: String(options.codec || existing?.codec || "avc1.42E01E"),
    mimeType: String(options.mimeType || existing?.mimeType || "video/mp4"),
    targetDuration: clampInteger(options.targetDuration, 1, 10, existing?.targetDuration ?? 1),
    windowSize: clampInteger(options.windowSize, 3, 20, existing?.windowSize ?? 5),
    initSegment: existing?.initSegment || null,
    segments: existing?.segments || [],
    ended: false
  };
  sessions.set(key, session);
  return publicSession(session);
}

export function saveLiveInitSegment(worldId, cameraId, pov, initSegment) {
  const session = ensureSession(worldId, cameraId, pov);
  session.initSegment = {
    mimeType: String(initSegment.mimeType || session.mimeType || "video/mp4"),
    data: toBuffer(initSegment.data),
    savedAt: new Date().toISOString()
  };
  session.updatedAt = new Date().toISOString();
  return publicSession(session);
}

export function saveLiveSegment(worldId, cameraId, pov, segment) {
  const session = ensureSession(worldId, cameraId, pov);
  const normalized = {
    sequence: clampInteger(segment.sequence, 0, Number.MAX_SAFE_INTEGER, session.segments.at(-1)?.sequence + 1 || 0),
    duration: clampNumber(segment.duration, 0.2, 10, session.targetDuration),
    mimeType: String(segment.mimeType || session.mimeType || "video/mp4"),
    independent: Boolean(segment.independent ?? session.segments.length === 0),
    data: toBuffer(segment.data),
    savedAt: new Date().toISOString()
  };

  const existingIndex = session.segments.findIndex((entry) => entry.sequence === normalized.sequence);
  if (existingIndex >= 0) {
    session.segments.splice(existingIndex, 1, normalized);
  } else {
    session.segments.push(normalized);
  }
  session.segments.sort((a, b) => a.sequence - b.sequence);
  if (session.segments.length > session.windowSize) {
    session.segments = session.segments.slice(-session.windowSize);
  }
  session.updatedAt = new Date().toISOString();
  session.ended = false;
  return publicSession(session);
}

export function endLiveSession(worldId, cameraId, pov) {
  const session = getLiveSession(worldId, cameraId, pov);
  if (!session) return null;
  session.ended = true;
  session.updatedAt = new Date().toISOString();
  return publicSession(session);
}

export function getLiveSession(worldId, cameraId, pov) {
  return sessions.get(makeKey(worldId, cameraId, pov)) || null;
}

export function getLiveStatus(worldId, cameraId) {
  const camera = ["camera", "player"]
    .map((pov) => getLiveSession(worldId, cameraId, pov))
    .filter(Boolean);
  return {
    available: camera.length > 0,
    streams: camera.map(publicSession)
  };
}

export function getLiveInitSegment(worldId, cameraId, pov) {
  return getLiveSession(worldId, cameraId, pov)?.initSegment || null;
}

export function getLiveSegment(worldId, cameraId, pov, sequence) {
  const session = getLiveSession(worldId, cameraId, pov);
  if (!session) return null;
  return session.segments.find((segment) => segment.sequence === Number(sequence)) || null;
}

export function buildLivePlaylist(worldId, cameraId, pov, query = {}) {
  const session = getLiveSession(worldId, cameraId, pov);
  if (!session || session.segments.length === 0) return null;

  const firstSequence = session.segments[0].sequence;
  const targetDuration = Math.max(session.targetDuration, ...session.segments.map((segment) => Math.ceil(segment.duration)));
  const queryString = buildQueryString(query);
  const lines = [
    "#EXTM3U",
    "#EXT-X-VERSION:7",
    `#EXT-X-TARGETDURATION:${targetDuration}`,
    `#EXT-X-MEDIA-SEQUENCE:${firstSequence}`,
    "#EXT-X-INDEPENDENT-SEGMENTS"
  ];

  if (session.initSegment) {
    lines.push(`#EXT-X-MAP:URI="init.mp4${queryString}"`);
  }

  for (const segment of session.segments) {
    lines.push(`#EXTINF:${segment.duration.toFixed(3)},`);
    lines.push(`segment-${segment.sequence}.m4s${queryString}`);
  }

  if (session.ended) {
    lines.push("#EXT-X-ENDLIST");
  }

  return lines.join("\n") + "\n";
}

function ensureSession(worldId, cameraId, pov) {
  return sessions.get(makeKey(worldId, cameraId, pov)) || createSession(worldId, cameraId, pov);
}

function createSession(worldId, cameraId, pov) {
  startLiveSession(worldId, cameraId, pov, {});
  return sessions.get(makeKey(worldId, cameraId, pov));
}

function publicSession(session) {
  return {
    worldId: session.worldId,
    cameraId: session.cameraId,
    pov: session.pov,
    codec: session.codec,
    mimeType: session.mimeType,
    targetDuration: session.targetDuration,
    windowSize: session.windowSize,
    sequenceStart: session.segments[0]?.sequence ?? null,
    sequenceEnd: session.segments.at(-1)?.sequence ?? null,
    segmentCount: session.segments.length,
    hasInitSegment: Boolean(session.initSegment),
    startedAt: session.startedAt,
    updatedAt: session.updatedAt,
    ended: session.ended
  };
}

function makeKey(worldId, cameraId, pov) {
  return `${worldId}:${cameraId}:${pov === "player" ? "player" : "camera"}`;
}

function toBuffer(data) {
  const stringValue = String(data || "");
  const base64 = stringValue.startsWith("data:")
    ? stringValue.slice(stringValue.indexOf(",") + 1)
    : stringValue;
  return Buffer.from(base64, "base64");
}

function buildQueryString(query) {
  const params = new URLSearchParams();
  if (query.code) params.set("code", String(query.code));
  if (query.accountToken) params.set("accountToken", String(query.accountToken));
  const stringValue = params.toString();
  return stringValue ? `?${stringValue}` : "";
}

function clampInteger(value, min, max, fallback) {
  const parsed = Number.parseInt(value ?? fallback, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}
