const pathParts = window.location.pathname.split("/");
const worldId = decodeURIComponent(pathParts[pathParts.length - 1] || "");
const params = new URLSearchParams(window.location.search);
let shareCode = params.get("code") || "";
let selectedCameraId = params.get("camera") || "";
let selectedPov = params.get("pov") === "player" ? "player" : "camera";
let activeRoom = null;
let cameras = [];
const accountToken = localStorage.getItem("minecraftcameras.accountToken") || "";
let canControl = false;

const socket = io();
const worldName = document.querySelector("#worldName");
const worldMeta = document.querySelector("#worldMeta");
const shareCodeForm = document.querySelector("#shareCodeForm");
const shareCodeInput = document.querySelector("#shareCodeInput");
const cameraList = document.querySelector("#cameraList");
const frame = document.querySelector("#frame");
const emptyState = document.querySelector("#emptyState");
const viewerMeta = document.querySelector("#viewerMeta");
const cameraPovButton = document.querySelector("#cameraPovButton");
const playerPovButton = document.querySelector("#playerPovButton");
const controlPanel = document.querySelector("#controlPanel");
const yawInput = document.querySelector("#yawInput");
const pitchInput = document.querySelector("#pitchInput");
const fovInput = document.querySelector("#fovInput");
const yawValue = document.querySelector("#yawValue");
const pitchValue = document.querySelector("#pitchValue");
const fovValue = document.querySelector("#fovValue");
const sendControlButton = document.querySelector("#sendControlButton");
const controlStatus = document.querySelector("#controlStatus");

cameraPovButton.addEventListener("click", () => switchPov("camera"));
playerPovButton.addEventListener("click", () => switchPov("player"));
for (const input of [yawInput, pitchInput, fovInput]) {
  input.addEventListener("input", updateControlValues);
}
sendControlButton.addEventListener("click", sendControls);

shareCodeInput.value = shareCode;
shareCodeForm.addEventListener("submit", (event) => {
  event.preventDefault();
  shareCode = shareCodeInput.value.trim();
  loadWorld();
});

socket.on("camera:frame", (payload) => {
  if (payload.cameraId !== selectedCameraId) return;
  if ((payload.pov || "camera") !== selectedPov) return;
  frame.src = payload.image;
  frame.classList.add("visible");
  emptyState.hidden = true;
  viewerMeta.textContent = `${selectedPov === "camera" ? "Camera POV" : "Player POV"} - ${payload.width}x${payload.height} at ${payload.fps || "?"} FPS target, received ${new Date(payload.receivedAt).toLocaleTimeString()}`;
});

async function fetchJson(url) {
  const headers = accountToken ? { "X-Account-Token": accountToken } : {};
  const response = await fetch(url, { headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || response.statusText);
  return data;
}

async function loadWorld() {
  const suffix = shareCode ? `?code=${encodeURIComponent(shareCode)}` : "";
  try {
    const worldData = await fetchJson(`/api/worlds/${encodeURIComponent(worldId)}${suffix}`);
    const camerasData = await fetchJson(`/api/worlds/${encodeURIComponent(worldId)}/cameras${suffix}`);
    canControl = await ownsCurrentWorld();
    cameras = camerasData.cameras;
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
      <small>${camera.x}, ${camera.y}, ${camera.z} - ${Math.round(camera.yaw)} / ${Math.round(camera.pitch)} / ${Math.round(camera.fov)} FOV</small>
    </button>
  `).join("");

  for (const button of cameraList.querySelectorAll("[data-camera]")) {
    button.addEventListener("click", () => joinCamera(button.dataset.camera));
  }
}

function joinCamera(cameraId) {
  if (activeRoom) socket.emit("viewer:leave", activeRoom);
  selectedCameraId = cameraId;
  activeRoom = { worldId, cameraId, pov: selectedPov };
  frame.classList.remove("visible");
  emptyState.hidden = false;
  emptyState.textContent = "Waiting for camera frames...";
  socket.emit("viewer:join", { worldId, cameraId, code: shareCode, accountToken, pov: selectedPov }, (reply) => {
    if (!reply?.ok) emptyState.textContent = reply?.error || "Could not join camera.";
  });
  for (const row of cameraList.querySelectorAll(".camera-row")) {
    row.classList.toggle("selected", row.dataset.camera === cameraId);
  }
  loadControlValues();
}

function switchPov(pov) {
  selectedPov = pov === "player" ? "player" : "camera";
  cameraPovButton.classList.toggle("selected", selectedPov === "camera");
  playerPovButton.classList.toggle("selected", selectedPov === "player");
  if (selectedCameraId) joinCamera(selectedCameraId);
}

function loadControlValues() {
  const camera = cameras.find((item) => item.cameraId === selectedCameraId);
  controlPanel.hidden = !camera || !canControl;
  if (!camera) return;
  yawInput.value = Math.round(camera.yaw || 0);
  pitchInput.value = Math.round(camera.pitch || 0);
  fovInput.value = Math.round(camera.fov || 70);
  updateControlValues();
}

async function ownsCurrentWorld() {
  if (!accountToken) return false;
  try {
    const data = await fetchJson("/api/account/worlds");
    return (data.worlds || []).some((world) => world.worldId === worldId);
  } catch (_error) {
    return false;
  }
}

function updateControlValues() {
  yawValue.textContent = `${yawInput.value} deg`;
  pitchValue.textContent = `${pitchInput.value} deg`;
  fovValue.textContent = `${fovInput.value} deg`;
}

async function sendControls() {
  if (!selectedCameraId || !accountToken) return;
  controlStatus.textContent = "Sending...";
  try {
    const response = await fetch(`/api/worlds/${encodeURIComponent(worldId)}/cameras/${encodeURIComponent(selectedCameraId)}/control`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Account-Token": accountToken
      },
      body: JSON.stringify({
        yaw: Number(yawInput.value),
        pitch: Number(pitchInput.value),
        fov: Number(fovInput.value)
      })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || response.statusText);
    const camera = cameras.find((item) => item.cameraId === selectedCameraId);
    if (camera) {
      camera.yaw = data.command.yaw;
      camera.pitch = data.command.pitch;
      camera.fov = data.command.fov;
      renderCameras(cameras);
    }
    controlStatus.textContent = "Sent to Minecraft.";
  } catch (error) {
    controlStatus.textContent = error.message;
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

switchPov(selectedPov);
loadWorld();
