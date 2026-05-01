# MinecraftCameras Website

Node.js Express + Socket.IO app for Minecraft camera worlds.

The site now supports two viewer pipelines:

- Latest-frame JPEG updates for the existing image-based stream.
- Continuous HLS playback when the renderer uploads pre-encoded fMP4 init and media segments.

## Local Run

```powershell
npm install
npm run dev
```

Open `http://localhost:3000`.

## API Highlights

- `GET /` - homepage with public worlds.
- `GET /world/:worldId` - viewer for a world.
- `GET /link` - website account/world linking page.
- `GET /api/public-worlds` - public world list.
- `POST /api/worlds/register` - mod registers world/camera metadata.
- `POST /api/worlds/:worldId/visibility` - mod updates `public`, `private`, or `allowed`.
- `POST /api/worlds/:worldId/share-codes` - mod creates allowed-view share codes.
- `POST /api/worlds/:worldId/link-codes` - mod creates account link codes.
- `POST /api/link-codes/redeem` - website links a browser account to a world.
- `POST /api/worlds/:worldId/cameras/:cameraId/control` - linked account queues camera yaw/pitch/FOV changes.
- `GET /api/worlds/:worldId/control-commands` - mod polls queued camera controls.
- `DELETE /api/share-codes/:codeId` - mod revokes a share code with `X-World-Secret`.
- `POST /api/worlds/:worldId/cameras/:cameraId/frame` - mod/renderer uploads latest frame.
- `POST /api/worlds/:worldId/cameras/:cameraId/live/session` - start or refresh a live HLS session.
- `POST /api/worlds/:worldId/cameras/:cameraId/live/init` - upload the HLS init segment.
- `POST /api/worlds/:worldId/cameras/:cameraId/live/segment` - upload an fMP4 media segment.
- `POST /api/worlds/:worldId/cameras/:cameraId/live/end` - end a live HLS session.
- `GET /api/worlds/:worldId/cameras/:cameraId/live/status` - inspect which POVs have a live stream available.
- `GET /live/:worldId/:cameraId/:pov/index.m3u8` - viewer playlist route.

## Live Streaming Notes

- The Render server does not need `ffmpeg`.
- The server stores a small in-memory sliding window of HLS segments per camera and POV.
- Browsers will prefer HLS playback when a live stream exists, then fall back to the latest-frame image feed when it does not.
- The Forge mod still needs a client-side encoder and segment uploader before the HLS path becomes end-to-end.

## Render

The repository root includes `render.yaml`. It creates a Node web service rooted at `web/` and mounts a persistent disk for SQLite data.
