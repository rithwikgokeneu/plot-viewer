# Plot Viewer → Multi-Project Engine — Design Spec

- **Date:** 2026-07-06
- **Branch:** `v3-engine` (off `v1`)
- **Status:** Approved design, pre-implementation

## 1. Context & Problem

Plot Viewer today is a single-project, browser-local tool:

- All data (map image + plots) is stored in the admin's own browser via `idb-keyval` (IndexedDB, key `plot-project`). The public page reads that **same browser's** storage.
- Consequence: a "shareable link" cannot work — a visitor's browser has no data. Only **one** project can exist (single fixed key). Admin "auth" is a client-side password (`NEXT_PUBLIC_ADMIN_PASSWORD`) — no real security; `AdminGate.tsx` itself notes server-side auth is the planned step.
- The map is a static `<img>` + SVG overlay in a fixed-aspect container. No zoom or pan; on mobile it only shrinks to fit width.

The goal is to turn this into a hosted **engine**: the operator creates many projects, each map is deep-zoomable without quality loss, each project has a public shareable link, and the UI is clean across mobile screen sizes.

## 2. Goals

1. **Multi-project engine** — operator creates/manages many independent projects.
2. **Shareable public links** — `/p/<slug>` works for anyone, on any device.
3. **Deep-zoom maps** — crisp at any zoom level (Google-Maps-style), on desktop and mobile.
4. **Clean responsive UI** — map and controls look good on phones, tablets, desktop.
5. **Real single-operator auth** — server-side password gate for all admin actions.

## 3. Non-Goals (YAGNI)

- Multi-user / client accounts, invites, per-user ownership (single operator only for now).
- Payments/billing.
- CAD/DXF import (dropped after v2), OCR of plot numbers (`tesseract.js` removed).
- Real-time multi-editor collaboration.
- Migrating the existing IndexedDB project (fresh start via re-upload — see §11).

## 4. Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Backend | **Vercel Postgres + Vercel Blob** | Single vendor, matches deploy target. |
| Zoom | **Deep-zoom tile pyramid** (OpenSeadragon + `sharp`) | "No quality loss at any zoom" on large maps. |
| Auth | **Single operator**, server-checked password + signed httpOnly cookie | Operator makes projects; clients only view. |
| Existing IndexedDB data | Do not migrate; re-upload | Only test data exists. |
| Branch | `v3-engine` off `v1` | `v1` is the advanced base (DXF dropped). |
| Domain | Vercel URL first; Namecheap custom domain later | Ship, then wire DNS. |

## 5. Architecture

Stack: Next.js 16 (App Router, existing) · Vercel Postgres · Vercel Blob · OpenSeadragon + `openseadragon-svg-overlay` · `sharp` (tiling) · Tailwind 4.

### 5.1 Data model (Postgres — single table)

One table keeps saves atomic, mirroring the current all-at-once `saveProject` pattern. Plots live as a JSONB array (hundreds per project, always loaded/saved together, counts computed client-side — a join buys nothing here).

```
projects
  id          uuid pk default gen_random_uuid()
  slug        text unique not null    -- public link: /p/green-valley-2
  name        text not null
  nat_w       int  not null           -- native image width  (px)
  nat_h       int  not null           -- native image height (px)
  image_url   text                    -- original full-res image in Blob (for re-tile/re-detect)
  dzi_url     text                    -- deep-zoom .dzi descriptor URL in Blob (null until tiled)
  plots       jsonb not null default '[]'
  status      text not null default 'draft'   -- 'draft' | 'published'
  created_at  timestamptz not null default now()
  updated_at  timestamptz not null default now()
```

`plots` JSONB element shape:

```jsonc
{
  "id": 1,
  "num": "12",
  "polygon": [{ "x": 0.31, "y": 0.44 }, ...],  // NORMALIZED 0..1 image coords
  "centroid": { "x": 0.33, "y": 0.46 },        // normalized
  "status": "available"                         // available|reserved|booked|sold
}
```

### 5.2 Coordinate system (key change)

Polygons/centroids are stored in **normalized `0..1` image coordinates**, not proc-resolution pixels.

- Resolution-independent → survive any tile resolution and feed OpenSeadragon's viewport (which uses normalized coords where image width = `1.0`) directly.
- Detection still runs client-side at proc resolution (unchanged `detectPlots`), then each coord is divided by `procW`/`procH` to normalize before saving.
- Aspect ratio: OSD's y-axis is normalized by image **width**, so `y_osd = y_norm * (nat_h / nat_w)`. The viewer converts stored `0..1` (of height) to OSD's coordinate space using `nat_w`/`nat_h`. Store `0..1` of each axis; convert at render.

### 5.3 Storage (Vercel Blob)

Deterministic keys per project under prefix `projects/<id>/`, uploaded with `addRandomSuffix: false` so paths are predictable:

- `projects/<id>/original.<ext>` — full-res upload (kept for re-detect / re-tile).
- `projects/<id>/dz.dzi` — deep-zoom descriptor.
- `projects/<id>/dz_files/<level>/<col>_<row>.webp` — tile pyramid (webp = smaller).

`sharp(...).tile({ layout: 'dzi', ... })` emits `dz.dzi` + a sibling `dz_files/` tree. OpenSeadragon derives tile URLs from the `.dzi` URL by convention (`dz.dzi` → `dz_files/…`), so tiles **must** sit at the sibling Blob path. `addRandomSuffix: false` guarantees the pathname equals our key, so the public Blob URL `https://<store>.public.blob.vercel-storage.com/projects/<id>/dz.dzi` resolves its tiles correctly.

### 5.4 Upload + tiling pipeline

Vercel serverless request bodies cap at ~4.5 MB, so large maps upload **client → Blob directly**.

New/replace-map flow (admin):

1. Admin selects file; if HEIC, convert to PNG via `heic2any` (kept).
2. Client loads image, runs existing `detectPlots` at proc resolution, **normalizes** polygon + centroid coords to `0..1`.
3. Client `POST /api/projects` (or `PATCH` on replace) with `{ name, slug, nat_w, nat_h, plots }` → row upserted (`status='draft'`, `image_url=null`, `dzi_url=null`) → **returns the project `id`** (needed for the Blob path).
4. Client uploads the original blob straight to Vercel Blob using `@vercel/blob` client upload; the token endpoint `POST /api/blob/upload` authorizes it (cookie-guarded) and pins the pathname to `projects/<id>/original.<ext>`. On success, `PATCH /api/projects/[id]` sets `image_url`.
5. Client triggers `POST /api/projects/[id]/tile`: server reads the original from Blob, runs `sharp().tile()`, uploads the `.dzi` + tiles to Blob, sets `dzi_url`, bumps `updated_at`.
6. Editor shows the original image immediately; deep-zoom activates once `dzi_url` is set (await the tile call; show a "preparing deep zoom…" state).

### 5.5 Pages / routes

```
PUBLIC
  /                 index of PUBLISHED projects (cards → /p/<slug>)
  /p/[slug]         THE SHAREABLE LINK — deep-zoom map + availability panel
                    (server component loads published project by slug; 404 if draft/missing)

ADMIN  (cookie-gated)
  /admin            projects list: create, publish/unpublish, copy public link, delete
  /admin/[id]       editor: upload/replace, auto-detect, add/remove boxes, set status, edit name/slug, publish
  /admin/login      password form → POST /api/admin/login

API (Route Handlers)
  POST   /api/admin/login          verify ADMIN_PASSWORD env → set signed httpOnly cookie
  POST   /api/blob/upload          Vercel Blob client-upload token (guarded, pins pathname)
  POST   /api/projects             create project (guarded)
  PATCH  /api/projects/[id]        update name/slug/status/plots/image_url (guarded)
  DELETE /api/projects/[id]        delete project + its Blob objects (guarded)
  POST   /api/projects/[id]/tile   sharp tiling → Blob → set dzi_url (guarded)
  (public reads use server components hitting the DB directly — no public API)
```

### 5.6 Auth

- Env (server-only, **not** `NEXT_PUBLIC`): `ADMIN_PASSWORD`, `AUTH_SECRET`.
- Login: verify `password === ADMIN_PASSWORD`; set a **stateless HMAC-signed httpOnly cookie** (`HMAC(AUTH_SECRET, "admin")`), `Secure`, `SameSite=Lax`. No session store needed.
- Enforcement: Next middleware guards `/admin/*` (except `/admin/login`) and all mutating `/api/*` by verifying the cookie HMAC.
- `AdminGate.tsx` client password gate is removed.

### 5.7 Deep-zoom viewer — `DeepZoomMap.tsx` (replaces `PlotMap.tsx`)

- Initialize OpenSeadragon with `tileSources: dziUrl`.
- `openseadragon-svg-overlay` renders plot polygons as SVG in image coords → crisp vectors at every zoom; native pinch-zoom + drag-pan on mobile.
- **Public:** tap a plot → select → show status (bottom sheet on mobile).
- **Admin:** tap → status/delete popup; add-mode draws a box — convert pointer to image coords via `viewport.pointerToImageCoordinates`, then normalize. Reuses existing `STATUS` colors, tilt logic, and click-popup behavior.

### 5.8 Responsive / clean UI

- **Public mobile:** map fills ~70vh; availability shown as a compact top strip; tapping a plot opens a bottom sheet (plot number + status). Desktop keeps map + right sidebar. Tap targets ≥ 44px.
- **Admin mobile:** toolbar wraps; detection settings stay in the existing `<details>` drawer; editor map full-width.
- Reuse existing status color tokens; refine typography/spacing during build (frontend-design pass in the implementation plan).

### 5.9 Dependencies

- **Remove:** `konva`, `react-konva`, `idb-keyval`, `dxf-parser`, `tesseract.js` (all verified unused on `v1`, except `idb-keyval` which is replaced by the server).
- **Add:** `@vercel/blob`, `@vercel/postgres`, `sharp`, `openseadragon` (+ `@types/openseadragon`), `openseadragon-svg-overlay`.
- **Keep:** `heic2any` (HEIC conversion), custom `detect.ts` CV pipeline, `vitest`.

## 6. Build Phases (→ implementation plan)

Each phase is independently shippable and testable.

1. **Backend foundation** — Postgres schema + client, Blob setup, project CRUD API, admin auth cookie + middleware, `/admin` projects list, editor persists to DB (shows original image, no tiles yet). Removes IndexedDB.
2. **Deep-zoom** — `sharp` tiling route, client Blob upload, `DeepZoomMap` with OSD + SVG overlay, wire public `/p/[slug]` and admin editor to it. Coordinate normalization end-to-end.
3. **Responsive polish** — mobile bottom sheets, landing index, copy-link button, publish/unpublish toggle, touch targets, typography pass.

## 7. Testing

- **Unit (vitest, existing setup):** keep `detect.test.ts`; add tests for coord normalization/denormalization, slug generation, plots JSON (de)serialization.
- **Integration:** project CRUD API requires auth; create → save plots → publish → public read-by-slug returns published only, 404s drafts.
- **Manual / e2e (Playwright available):** upload → tile → deep-zoom renders and stays crisp at high zoom on a mobile viewport; overlay clicks map to correct plots.

## 8. Risks & Constraints

1. **Tile generation on Vercel serverless** has time/memory caps. Very large maps may exceed Hobby limits — may need Pro plan + higher `maxDuration`, or a job queue. Mitigate with webp tiles and a sane tile size; flag if maps are huge.
2. **Next.js 16 API drift** — `AGENTS.md` warns this is not stock Next: `params` is now a Promise, middleware/proxy conventions differ. **Read `node_modules/next/dist/docs/` before writing routing/middleware/route-handler code.**
3. **Tile count per map** can be large (storage + upload time). Mitigated by webp + reasonable tile size.
4. **Blob path determinism** — must upload with `addRandomSuffix: false` or OSD tile-URL derivation breaks.

## 9. Success Criteria

- Operator logs in server-side, creates ≥2 projects, each with its own map + plots.
- Each published project has a `/p/<slug>` link that shows the correct map + availability on a fresh device/browser (no shared storage).
- Map zooms deeply and stays crisp; polygons stay aligned and crisp at all zoom levels.
- Public and admin views are usable and clean on a phone.

## 10. Open Questions

None blocking. Domain wiring (Namecheap) and Vercel plan tier (if tiling hits limits) are deferred operational steps, not design unknowns.
