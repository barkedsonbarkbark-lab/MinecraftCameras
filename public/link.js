const tokenKey = "minecraftcameras.accountToken";
const form = document.querySelector("#linkForm");
const nameInput = document.querySelector("#displayNameInput");
const codeInput = document.querySelector("#linkCodeInput");
const status = document.querySelector("#linkStatus");
const worlds = document.querySelector("#accountWorlds");

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  status.textContent = "Linking...";
  try {
    const response = await fetch("/api/link-codes/redeem", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        displayName: nameInput.value.trim(),
        code: codeInput.value.trim()
      })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || response.statusText);
    localStorage.setItem(tokenKey, data.account.token);
    status.textContent = "Linked. Opening your world...";
    window.location.href = `/world/${encodeURIComponent(data.worldId)}`;
  } catch (error) {
    status.textContent = error.message;
  }
});

async function loadAccountWorlds() {
  const token = localStorage.getItem(tokenKey);
  if (!token) {
    worlds.innerHTML = "";
    return;
  }
  const response = await fetch("/api/account/worlds", {
    headers: { "X-Account-Token": token }
  });
  const data = await response.json().catch(() => ({}));
  const linkedWorlds = data.worlds || [];
  if (linkedWorlds.length === 0) {
    worlds.innerHTML = "";
    return;
  }
  worlds.innerHTML = linkedWorlds.map((world) => `
    <a class="world-card" href="/world/${encodeURIComponent(world.worldId)}">
      <strong>${escapeHtml(world.worldName)}</strong>
      <span>${world.cameraCount} camera${world.cameraCount === 1 ? "" : "s"}</span>
      <small>${escapeHtml(world.visibility)} visibility</small>
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

loadAccountWorlds();
