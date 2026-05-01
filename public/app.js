const container = document.querySelector("#publicCameras");
const lookup = document.querySelector("#worldLookup");
const worldInput = document.querySelector("#worldIdInput");

lookup.addEventListener("submit", (event) => {
  event.preventDefault();
  const worldId = worldInput.value.trim();
  if (worldId) window.location.href = `/world/${encodeURIComponent(worldId)}`;
});

function formatTime(value) {
  if (!value) return "No frames yet";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

async function loadPublicCameras() {
  const response = await fetch("/api/public-cameras");
  const data = await response.json();
  const cameras = data.cameras || [];

  if (cameras.length === 0) {
    container.innerHTML = `<div class="notice">No public cameras are online yet.</div>`;
    return;
  }

  container.innerHTML = cameras.map((camera) => `
    <a class="camera-card" href="/world/${encodeURIComponent(camera.worldId)}?camera=${encodeURIComponent(camera.cameraId)}">
      <span class="status ${camera.lastFrameAt ? "online" : ""}"></span>
      <strong>${escapeHtml(camera.cameraName)}</strong>
      <span>${escapeHtml(camera.worldName)}</span>
      <small>${escapeHtml(camera.dimension)} (${camera.x}, ${camera.y}, ${camera.z})</small>
      <small>Last frame: ${formatTime(camera.lastFrameAt)}</small>
    </a>
  `).join("");
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[char]));
}

loadPublicCameras().catch((error) => {
  container.innerHTML = `<div class="notice">Could not load public cameras: ${escapeHtml(error.message)}</div>`;
});

