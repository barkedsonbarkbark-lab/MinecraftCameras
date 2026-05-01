const container = document.querySelector("#publicWorlds");
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

async function loadPublicWorlds() {
  const response = await fetch("/api/public-worlds");
  const data = await response.json();
  const worlds = data.worlds || [];

  if (worlds.length === 0) {
    container.innerHTML = `<div class="notice">No public worlds are online yet.</div>`;
    return;
  }

  container.innerHTML = worlds.map((world) => `
    <a class="world-card" href="/world/${encodeURIComponent(world.worldId)}">
      <span class="status ${world.lastFrameAt ? "online" : ""}"></span>
      <strong>${escapeHtml(world.worldName)}</strong>
      <span>${world.cameraCount} camera${world.cameraCount === 1 ? "" : "s"}</span>
      <small>World ID: ${escapeHtml(world.worldId)}</small>
      <small>Last frame: ${formatTime(world.lastFrameAt)}</small>
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

loadPublicWorlds().catch((error) => {
  container.innerHTML = `<div class="notice">Could not load public worlds: ${escapeHtml(error.message)}</div>`;
});
