import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import { Server } from "socket.io";
import {
  canControlWorld,
  createLinkCode,
  createShareCode,
  findShareCodeById,
  findShareCode,
  getFrame,
  getWorld,
  listAccountWorlds,
  listCameras,
  listPublicCameras,
  listPublicWorlds,
  registerWorld,
  redeemLinkCode,
  revokeShareCode,
  saveFrame,
  saveControlCommand,
  setVisibility,
  takeControlCommands
} from "./db.js";
import { canViewWorld, makeRoom, normalizePov, normalizeVisibility } from "./lib/access.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
  maxHttpBufferSize: 8 * 1024 * 1024
});

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json({ limit: "8mb" }));
app.use(express.static(path.join(__dirname, "public")));

function publicWorld(world) {
  if (!world) return null;
  const { secret, ...safe } = world;
  return safe;
}

function requireWorldSecret(req, res, next) {
  const world = getWorld(req.params.worldId);
  if (!world) return res.status(404).json({ error: "World not found" });
  const provided = req.header("x-world-secret");
  if (!provided || provided !== world.secret) {
    return res.status(401).json({ error: "Invalid world secret" });
  }
  req.world = world;
  return next();
}

function requireOwner(req, res, next) {
  const token = req.header("x-account-token");
  if (!canControlWorld(req.params.worldId, token)) {
    return res.status(401).json({ error: "Link this world to your account before controlling cameras." });
  }
  return next();
}

function authorizeViewer(req, res, next) {
  const world = getWorld(req.params.worldId);
  if (!world) return res.status(404).json({ error: "World not found" });
  const shareCode = findShareCode(world.worldId, req.query.code || req.header("x-share-code"));
  if (!canViewWorld(world, shareCode) && !canControlWorld(world.worldId, req.header("x-account-token"))) {
    return res.status(403).json({ error: "This world is not public. A valid share code is required." });
  }
  req.world = world;
  return next();
}

app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/world/:worldId", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "world.html"));
});

app.get("/link", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "link.html"));
});

app.get("/login", (_req, res) => {
  res.redirect("/link");
});

app.get("/api/public-cameras", (_req, res) => {
  res.json({ cameras: listPublicCameras() });
});

app.get("/api/public-worlds", (_req, res) => {
  res.json({ worlds: listPublicWorlds() });
});

app.get("/api/account/worlds", (req, res) => {
  res.json({ worlds: listAccountWorlds(req.header("x-account-token")) });
});

app.post("/api/link-codes/redeem", (req, res) => {
  const result = redeemLinkCode(req.body.code, req.body.displayName);
  if (!result) return res.status(404).json({ error: "That link code was not found or was already used." });
  res.status(201).json(result);
});

app.post("/api/worlds/register", (req, res) => {
  try {
    const world = registerWorld(req.body);
    res.json({ world: publicWorld(world), secret: world.secret });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post("/api/worlds/:worldId/visibility", requireWorldSecret, (req, res) => {
  const world = setVisibility(req.params.worldId, normalizeVisibility(req.body.visibility));
  res.json({ world: publicWorld(world) });
});

app.get("/api/worlds/:worldId", authorizeViewer, (req, res) => {
  res.json({ world: publicWorld(req.world) });
});

app.get("/api/worlds/:worldId/cameras", authorizeViewer, (req, res) => {
  res.json({ cameras: listCameras(req.params.worldId) });
});

app.post("/api/worlds/:worldId/share-codes", requireWorldSecret, (req, res) => {
  res.status(201).json({ shareCode: createShareCode(req.params.worldId) });
});

app.post("/api/worlds/:worldId/link-codes", requireWorldSecret, (req, res) => {
  res.status(201).json({ linkCode: createLinkCode(req.params.worldId, req.world.secret) });
});

app.delete("/api/share-codes/:codeId", (req, res) => {
  const shareCode = findShareCodeById(req.params.codeId);
  if (!shareCode) return res.status(404).json({ error: "Share code not found" });
  if (req.header("x-world-secret") !== shareCode.worldSecret) {
    return res.status(401).json({ error: "Invalid world secret" });
  }
  res.json({ revoked: revokeShareCode(req.params.codeId) });
});

app.post("/api/worlds/:worldId/cameras/:cameraId/frame", requireWorldSecret, (req, res) => {
  if (!req.body.image || !String(req.body.image).startsWith("data:image/")) {
    return res.status(400).json({ error: "image data URL is required" });
  }

  const frame = saveFrame(req.params.worldId, req.params.cameraId, {
    pov: normalizePov(req.body.pov),
    image: String(req.body.image),
    width: Number.parseInt(req.body.width ?? 0, 10),
    height: Number.parseInt(req.body.height ?? 0, 10),
    fps: req.body.fps == null ? null : Number(req.body.fps),
    capturedAt: req.body.capturedAt
  });

  io.to(makeRoom(req.params.worldId, req.params.cameraId, frame.pov)).emit("camera:frame", frame);
  res.status(202).json({ frame: { ...frame, image: undefined } });
});

app.post("/api/worlds/:worldId/cameras/:cameraId/control", requireOwner, (req, res) => {
  const command = saveControlCommand(req.params.worldId, req.params.cameraId, req.body);
  if (!command) return res.status(404).json({ error: "Camera not found" });
  io.to(`world:${req.params.worldId}`).emit("camera:control", command);
  res.status(202).json({ command });
});

app.get("/api/worlds/:worldId/control-commands", requireWorldSecret, (req, res) => {
  res.json({ commands: takeControlCommands(req.params.worldId) });
});

app.get("/api/worlds/:worldId/cameras/:cameraId/frame", authorizeViewer, (req, res) => {
  const frame = getFrame(req.params.worldId, req.params.cameraId, normalizePov(req.query.pov));
  if (!frame) return res.status(404).json({ error: "No frame has been received for this camera yet" });
  res.json({ frame });
});

io.on("connection", (socket) => {
  socket.on("viewer:join", ({ worldId, cameraId, code, accountToken, pov }, reply) => {
    const world = getWorld(String(worldId || ""));
    const shareCode = findShareCode(String(worldId || ""), code);
    if (!canViewWorld(world, shareCode) && !canControlWorld(String(worldId || ""), accountToken)) {
      reply?.({ ok: false, error: "Not allowed to view this camera" });
      return;
    }

    const normalizedPov = normalizePov(pov);
    const room = makeRoom(world.worldId, String(cameraId || ""), normalizedPov);
    socket.join(room);
    const latest = getFrame(world.worldId, String(cameraId || ""), normalizedPov);
    if (latest) socket.emit("camera:frame", latest);
    reply?.({ ok: true });
  });

  socket.on("viewer:leave", ({ worldId, cameraId, pov }) => {
    socket.leave(makeRoom(String(worldId || ""), String(cameraId || ""), normalizePov(pov)));
  });
});

const port = Number(process.env.PORT || 3000);
server.listen(port, () => {
  console.log(`Minecraft camera web listening on http://localhost:${port}`);
});
