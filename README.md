# Minecraft Camera Website

Node.js Express + Socket.IO app for Minecraft camera worlds.

## Local Run

```powershell
npm install
npm run dev
```

Open `http://localhost:3000`.

## API Highlights

- `GET /` - homepage with public cameras.
- `GET /world/:worldId` - viewer for a world.
- `GET /api/public-cameras` - public camera list.
- `POST /api/worlds/register` - mod registers world/camera metadata.
- `POST /api/worlds/:worldId/visibility` - mod updates `public`, `private`, or `allowed`.
- `POST /api/worlds/:worldId/share-codes` - mod creates allowed-view share codes.
- `DELETE /api/share-codes/:codeId` - mod revokes a share code with `X-World-Secret`.
- `POST /api/worlds/:worldId/cameras/:cameraId/frame` - mod/renderer uploads latest frame.

## Render

The repository root includes `render.yaml`. It creates a Node web service rooted at `web/` and mounts a persistent disk for SQLite data.

