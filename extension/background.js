// Sends import requests from the content script to the app's API. Running the
// request here (with host_permissions) avoids CORS from the catalog page origin.

// sends program page to POST /api/import/program
//  fetches any missing course pages one every 3 seconds and sends them to POST /api/import/course.

const DEFAULT_API = "http://localhost:3000";

async function apiBase() {
  const { apiBase } = await chrome.storage.sync.get({ apiBase: DEFAULT_API });
  return apiBase.replace(/\/+$/, "");
}

async function post(path, payload) {
  const res = await fetch(`${await apiBase()}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const path = { importProgram: "/api/import/program", importCourse: "/api/import/course" }[msg.type];
  if (!path) return false;
  post(path, msg.payload)
    .then((data) => sendResponse({ ok: true, data }))
    .catch((e) => sendResponse({ ok: false, error: String(e.message || e) }));
  return true; // async response
});
