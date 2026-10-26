# Roadmap Assistant Importer (Chrome extension)

Imports an SJSU MyRoadmaps program and its courses into the app, from the
student's own browser (catalog.sjsu.edu blocks server-side fetching).

## Install (development)
1. Run the app: `npm run dev` (serves http://localhost:3000).
2. Chrome → `chrome://extensions` → enable **Developer mode** → **Load unpacked** → select this `extension/` folder.
3. Open a program on catalog.sjsu.edu (MyRoadmaps catalog, e.g. `preview_program.php?catoid=10&poid=8855`).
4. Click **Import to Roadmap Assistant** (bottom-right of the page).

## How it works
- `content.js` sends the rendered program page to `POST /api/import/program`, which answers with the
  course pages it doesn't have yet. It then fetches those course pages from the catalog **one every
  3 seconds** (max 200 per run) and sends each to `POST /api/import/course`; prerequisite courses
  linked from those pages are queued too. Already-cached courses are never fetched again.
- `background.js` makes the calls to the app (host permissions, so no CORS setup is needed).
- The popup sets the app URL. For a deployed app, also add its origin to `host_permissions`
  in `manifest.json`.
- It never touches `/ajax/` URLs (disallowed by the catalog's robots.txt). If the catalog shows a
  verification challenge, the import stops and asks you to reload the page; re-running continues
  where it left off.
