const pathParts = window.location.pathname.split("/");
const worldId = decodeURIComponent(pathParts[pathParts.length - 1] || "");
const params = new URLSearchParams(window.location.search);
let shareCode = params.get("code") || "";
let selectedCameraId = params.get("camera") || "";
let activeRoom = null;

const socket = io();
const worldName = document.querySelector("#worldName");
const worldMeta = document.querySelector("#worldMeta");
const shareCodeForm = document.querySelector("#shareCodeForm");
const shareCodeInput = document.querySelector("#shareCodeInput");
const cameraList = document.querySelector("#cameraList");
const frame = document.querySelector("#frame");
const emptyState = document.querySelector("#emptyState");
const viewerMeta = document.querySelector("#viewerMeta");

shareCodeInput.value = shareCode;
shareCodeForm.addEventListener("submit", (event) => {
  event.preventDefault();
  shareCode = shareCodeInput.value.trim();
  loadWorld();
});

socket.on("camera:frame", (payload) => {
  if (payload.cameraId !== selectedCameraId) return;
  frame.src = payload.image;
  frame.classList.add("visible");
  emptyState.hidden = true;
  viewerMeta.textContent = `${payload.width}x${payload.height} at ${payload.fps || "?"} FPS target, received ${new Date(payload.receivedAt).toLocaleTimeString()}`;
});

async function fetchJson(url) {
  const response = await fetch(url);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || response.statusText);
  return data;
}

async function loadWorld() {
  const suffix = shareCode ? `?code=${encodeURIComponent(shareCode)}` : "";
  try {
    const worldData = await fetchJson(`/api/worlds/${encodeURIComponent(worldId)}${suffix}`);
    const camerasData = await fetchJson(`/api/worlds/${encodeURIComponent(worldId)}/cameras${suffix}`);
    worldName.textContent = worldData.world.name;
    worldMeta.textContent = `${worldData.world.visibility} visibility - ${camerasData.cameras.length} cameras`;
    renderCameras(camerasData.cameras);
    if (!selectedCameraId && camerasData.cameras[0]) selectedCameraId = camerasData.cameras[0].cameraId;
    if (selectedCameraId) joinCamera(selectedCameraId);
  } catch (error) {
    cameraList.innerHTML = `<div class="notice">${escapeHtml(error.message)}</div>`;
    worldMeta.textContent = "Enter a share code if this world is allowed-only.";
  }
}

function renderCameras(cameras) {
  cameraList.innerHTML = cameras.map((camera) => `
    <button class="camera-row ${camera.cameraId === selectedCameraId ? "selected" : ""}" data-camera="${escapeHtml(camera.cameraId)}">
      <strong>${escapeHtml(camera.name)}</strong>
      <span>${escapeHtml(camera.dimension)}</span>
      <small>${camera.x}, ${camera.y}, ${camera.z}</small>
    </button>
  `).join("");

  for (const button of cameraList.querySelectorAll("[data-camera]")) {
    button.addEventListener("click", () => joinCamera(button.dataset.camera));
  }
}

function joinCamera(cameraId) {
  if (activeRoom) socket.emit("viewer:leave", activeRoom);
  selectedCameraId = cameraId;
  activeRoom = { worldId, cameraId };
  frame.classList.remove("visible");
  emptyState.hidden = false;
  emptyState.textContent = "Waiting for camera frames...";
  socket.emit("viewer:join", { worldId, cameraId, code: shareCode }, (reply) => {
    if (!reply?.ok) emptyState.textContent = reply?.error || "Could not join camera.";
  });
  for (const row of cameraList.querySelectorAll(".camera-row")) {
    row.classList.toggle("selected", row.dataset.camera === cameraId);
  }
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

loadWorld();

