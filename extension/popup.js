const input = document.getElementById("api");
chrome.storage.sync.get({ apiBase: "http://localhost:3000" }).then(({ apiBase }) => (input.value = apiBase));
input.addEventListener("change", async () => {
  await chrome.storage.sync.set({ apiBase: input.value.trim() });
  const saved = document.getElementById("saved");
  saved.style.visibility = "visible";
  setTimeout(() => (saved.style.visibility = "hidden"), 1200);
});
