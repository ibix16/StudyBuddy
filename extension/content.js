// Runs on catalog.sjsu.edu program pages only. Adds an "Import" button that:
//   1. sends the already rendered program page to this app,
//   2. fetches each course page the app is missing, one at a time, at a slow
//      pace, and sends it to the app; prerequisite courses those pages link to
//      are queued too.
// Requests to catalog.sjsu.edu go out from this tab, so they use the visitor's
// normal session. Never call /ajax/ endpoints (disallowed by robots.txt).

(() => {
  const DELAY_MS = 3000; // pause between catalog requests
  const MAX_PAGES = 200; // safety cap per import
  const MAX_CONSECUTIVE_FAILURES = 3; // give up if the app keeps rejecting pages

  const own = document.documentElement.outerHTML.match(/portfolio\.php\?catoid=(\d+)&(?:amp;)?add=1&(?:amp;)?poid=(\d+)/);
  if (!own || !document.getElementById("acalog-page-title")) return;
  const catoid = Number(own[1]);

  const ui = mountPanel();
  let cancelled = false;

  // try-catch block for click event on button
  // on successfull : calls runImport()
  ui.button.addEventListener("click", async () => {
    ui.button.disabled = true;
    ui.cancel.hidden = false;
    cancelled = false;
    try {
      await runImport();
    } catch (e) {
      ui.status(`Import failed: ${e.message}`, "error");
    } finally {
      ui.button.disabled = false;
      ui.cancel.hidden = true;
    }
  });
  ui.cancel.addEventListener("click", () => (cancelled = true));



  async function runImport() {
    ui.status("Sending program…");
    const program = await send("importProgram", { html: document.documentElement.outerHTML });
    const queue = [...program.missing];
    const seen = new Set(queue);
    let done = 0;
    let lowConfidence = 0;
    const failed = [];
    let failStreak = 0;

    while (queue.length && !cancelled && done < MAX_PAGES) {
      const coid = queue.shift();
      ui.status(`Importing courses: ${done}/${done + queue.length + 1}`);
      ui.progress(done / (done + queue.length + 1));

      const res = await fetch(`/preview_course_nopop.php?catoid=${catoid}&coid=${coid}`, { credentials: "same-origin" });
      const html = await res.text();
      if (res.status === 202 || html.length < 1000) {
        // bot challenge instead of content (the session needs a normal page load)
        throw new Error("the catalog asked for verification.");
      }
      let result;
      try {
        result = await send("importCourse", { html, catoid, coid });
        failStreak = 0;
      } catch (e) {
        // Skip this course; stop only if every page is failing (likely an app problem).
        failed.push(coid);
        console.warn(`[Roadmap Assistant] course ${coid} not imported:`, e.message);
        if (++failStreak >= MAX_CONSECUTIVE_FAILURES) throw e;
      }
      if (result) {
        if (!result.prereqConfident) lowConfidence++;
        for (const next of result.missing) {
          if (!seen.has(next)) {
            seen.add(next);
            queue.push(next);
          }
        }
      }
      done++;
      if (queue.length) await sleep(DELAY_MS);
    }

    ui.progress(1);
    const imported = done - failed.length;
    const skipped = failed.length ? ` (${failed.length} skipped; see console)` : "";
    const summary = `${program.title}: imported ${imported} course${imported === 1 ? "" : "s"}${skipped}`;
    if (cancelled) ui.status(`${summary} (cancelled; run again to continue).`, "warn");
    else if (queue.length) ui.status(`${summary}; stopped at the ${MAX_PAGES}-page limit, run again to continue.`, "warn");
    else ui.status(`${summary}. Done!${lowConfidence ? ` ${lowConfidence} prerequisite(s) need review.` : ""}`, "ok");
  }

  function send(type, payload) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type, payload }, (reply) => {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        if (!reply?.ok) return reject(new Error(reply?.error || "no response from extension"));
        resolve(reply.data);
      });
    });
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  /** Floating panel in a shadow root so catalog CSS can't affect it (and vice versa). */
  function mountPanel() {
    const host = document.createElement("div");
    host.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:2147483647";
    const root = host.attachShadow({ mode: "closed" });
    root.innerHTML = `
      <style>
        .card { font: 13px system-ui, sans-serif; background: #fff; color: #1a1a1a; border: 1px solid #d0d4dc;
                border-radius: 10px; box-shadow: 0 4px 16px rgba(0,0,0,.15); padding: 12px; width: 260px; }
        .row { display: flex; gap: 8px; }
        button { font: inherit; border-radius: 6px; padding: 6px 10px; cursor: pointer; border: 1px solid #0055a2; }
        .go { background: #0055a2; color: #fff; flex: 1; }
        .go:disabled { opacity: .6; cursor: default; }
        .stop { background: #fff; color: #0055a2; }
        .bar { height: 4px; background: #e6e9ef; border-radius: 2px; margin-top: 10px; overflow: hidden; }
        .fill { height: 100%; width: 0; background: #0055a2; transition: width .3s; }
        .msg { margin-top: 8px; line-height: 1.35; }
        .error { color: #b3261e; } .warn { color: #8a5a00; } .ok { color: #1e7a3c; }
      </style>
      <div class="card">
        <div class="row"><button class="go">Import to Roadmap Assistant</button><button class="stop" hidden>Cancel</button></div>
        <div class="bar"><div class="fill"></div></div>
        <div class="msg"></div>
      </div>`;
    document.body.appendChild(host);
    const msg = root.querySelector(".msg");
    const fill = root.querySelector(".fill");
    return {
      button: root.querySelector(".go"),
      cancel: root.querySelector(".stop"),
      status(text, kind = "") {
        msg.textContent = text;
        msg.className = `msg ${kind}`;
      },
      progress(f) {
        fill.style.width = `${Math.round(f * 100)}%`;
      },
    };
  }
})();
