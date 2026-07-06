# Plot Viewer Multi-Project Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the browser-local single-project Plot Viewer into a hosted multi-project engine with server storage, deep-zoom maps, single-operator auth, and public shareable links.

**Architecture:** Next.js 16 App Router + Vercel Postgres (single `projects` table, plots as JSONB) + Vercel Blob (original image + deep-zoom tiles). Detection stays client-side; polygons are stored as normalized 0..1 coordinates. OpenSeadragon renders deep-zoom tiles with an SVG overlay for plots. A signed httpOnly cookie plus a Next 16 `proxy.ts` guard protect all admin surfaces.

**Tech Stack:** Next.js 16.2.10, React 19, TypeScript, Tailwind 4, `@vercel/postgres`, `@vercel/blob`, `sharp`, `openseadragon` + `openseadragon-svg-overlay`, `vitest`.

**Spec:** `docs/superpowers/specs/2026-07-06-plot-viewer-engine-design.md`

## Global Constraints

- **Next.js 16.2.10 API rules (verified against `node_modules/next/dist/docs/`):**
  - Route Handler dynamic params are a Promise: `{ params }: { params: Promise<{ id: string }> }` → `const { id } = await params`.
  - Page/Server-Component `params` is a Promise: `params: Promise<{ slug: string }>` → `await params`.
  - `cookies()` from `next/headers` is async: `const store = await cookies()`.
  - **Request interception uses `proxy.ts`, NOT `middleware.ts`** (renamed in v16). Export a function named `proxy`. Proxy defaults to the Node.js runtime (Node `crypto` is available). Do not set `runtime` inside `proxy` (throws).
  - Route Handler config exports: `export const runtime = 'nodejs'`, `export const maxDuration = 300` (seconds), `export const dynamic = 'force-dynamic'`.
  - Return JSON with `NextResponse.json(obj, { status })` (`import { NextResponse } from 'next/server'`) or `Response.json(obj)`.
- **Coordinates:** all stored plot `polygon`/`centroid` values are normalized `0..1` of each image axis. Never persist proc-pixel or image-pixel coordinates.
- **Blob:** always `put(..., { access: 'public', addRandomSuffix: false })` so deep-zoom tile URLs derive correctly from the `.dzi` URL.
- **Secrets:** `ADMIN_PASSWORD` and `AUTH_SECRET` are server-only. Never prefix with `NEXT_PUBLIC_`.
- **Status colors/labels:** always use the `STATUS`/`STATUS_ORDER` maps in `src/lib/plot.ts`. Never hardcode plot colors.
- **Testing:** pure logic uses vitest TDD (`npx vitest run <file>`); infra/routes/UI verify via `npm run build` + `curl`/Playwright as noted per task.
- **Commits:** frequent, one per task minimum. End messages with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

# Phase 1 — Backend Foundation

Outcome: projects persist in Postgres, admin is protected by real server-side auth, editor saves to the DB (still using the legacy `PlotMap`, original image shown, no tiles yet). IndexedDB removed.

### Task 1: Dependency swap, env, ambient types

**Files:**
- Modify: `package.json`
- Create: `.env.local.example`
- Create: `src/types/openseadragon-svg-overlay.d.ts`

**Interfaces:**
- Produces: the `openseadragon-svg-overlay` module augmentation adding `viewer.svgOverlay()` (consumed in Task 13).

- [ ] **Step 1: Remove unused deps, add new ones**

Run:
```bash
npm uninstall konva react-konva idb-keyval dxf-parser tesseract.js
npm install @vercel/postgres @vercel/blob sharp openseadragon openseadragon-svg-overlay
npm install -D @types/openseadragon
```

- [ ] **Step 2: Create `.env.local.example`**

```bash
# Vercel Postgres (from `vercel env pull` or the Storage tab)
POSTGRES_URL=

# Vercel Blob
BLOB_READ_WRITE_TOKEN=

# Single-operator admin auth (server-only — do NOT use NEXT_PUBLIC_)
ADMIN_PASSWORD=change-me
# 32+ random bytes, e.g. `openssl rand -hex 32`
AUTH_SECRET=
```

Then create the real `.env.local` locally with actual values (`openssl rand -hex 32` for `AUTH_SECRET`).

- [ ] **Step 3: Add ambient type for the OSD SVG-overlay plugin**

`src/types/openseadragon-svg-overlay.d.ts`:
```ts
import "openseadragon";

declare module "openseadragon" {
  interface Viewer {
    svgOverlay(): {
      node(): SVGGElement;
      resize(): void;
      onFlip(): void;
    };
  }
}
```

- [ ] **Step 4: Verify install + typecheck**

Run: `npx tsc --noEmit`
Expected: no errors from the new declaration file (pre-existing app code unaffected).

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json .env.local.example src/types/openseadragon-svg-overlay.d.ts
git commit -m "v3-engine: swap deps (remove konva/idb/dxf/tesseract, add postgres/blob/sharp/OSD) + env template"
```

---

### Task 2: Make `plot.ts` a pure module (drop IndexedDB)

**Files:**
- Modify: `src/lib/plot.ts`
- Test: `src/lib/plot.test.ts`

**Interfaces:**
- Consumes: `Pt` from `src/lib/detect.ts`.
- Produces: `type Status`, `STATUS`, `STATUS_ORDER`, `interface Plot`, `PROC_MAX`, `DISP_MAX_W`, `DISP_MAX_H`, `fit(w,h,maxW,maxH)`, `countByStatus(plots)`. **Removed:** `interface Project`, `saveProject`, `loadProject`, `clearProject`, and the `idb-keyval` import.

- [ ] **Step 1: Write the failing test**

`src/lib/plot.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { countByStatus, STATUS_ORDER, type Plot } from "./plot";

const plot = (id: number, status: Plot["status"]): Plot => ({
  id, num: String(id), polygon: [], centroid: { x: 0, y: 0 }, status,
});

describe("countByStatus", () => {
  it("counts each status and zero-fills missing ones", () => {
    const counts = countByStatus([plot(1, "available"), plot(2, "available"), plot(3, "sold")]);
    expect(counts.available).toBe(2);
    expect(counts.sold).toBe(1);
    expect(counts.reserved).toBe(0);
    expect(counts.booked).toBe(0);
  });
  it("returns all statuses in STATUS_ORDER", () => {
    const counts = countByStatus([]);
    for (const s of STATUS_ORDER) expect(counts[s]).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/plot.test.ts`
Expected: FAIL — `plot.ts` still imports `idb-keyval` (now uninstalled) → import/resolve error.

- [ ] **Step 3: Rewrite `plot.ts` as a pure module**

Replace the entire contents of `src/lib/plot.ts` with:
```ts
import type { Pt } from "./detect";

export type Status = "available" | "reserved" | "booked" | "sold";

export const STATUS: Record<Status, { label: string; color: string }> = {
  available: { label: "Available", color: "#16a34a" },
  reserved: { label: "Reserved", color: "#eab308" },
  booked: { label: "Booked", color: "#f97316" },
  sold: { label: "Sold", color: "#dc2626" },
};

export const STATUS_ORDER: Status[] = ["available", "reserved", "booked", "sold"];

export interface Plot {
  id: number;
  num: string;
  polygon: Pt[]; // normalized 0..1 of each image axis
  centroid: Pt; // normalized 0..1
  status: Status;
}

// Display and detection sizing.
export const DISP_MAX_W = 900;
export const DISP_MAX_H = 1250;
export const PROC_MAX = 1600;

export function fit(
  w: number,
  h: number,
  maxW: number,
  maxH: number
): { w: number; h: number; scale: number } {
  const scale = Math.min(maxW / w, maxH / h, 1);
  return { w: Math.round(w * scale), h: Math.round(h * scale), scale };
}

export function countByStatus(plots: Plot[]): Record<Status, number> {
  return STATUS_ORDER.reduce(
    (acc, s) => ({ ...acc, [s]: plots.filter((p) => p.status === s).length }),
    {} as Record<Status, number>
  );
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npx vitest run src/lib/plot.test.ts src/lib/detect.test.ts`
Expected: PASS (both files).

- [ ] **Step 5: Commit**

```bash
git add src/lib/plot.ts src/lib/plot.test.ts
git commit -m "v3-engine: plot.ts pure module (drop idb persistence + Project type)"
```

> Note: `PlotEditor.tsx` and `PublicViewer.tsx` still import `saveProject`/`loadProject` and will not typecheck until Tasks 10/13 migrate them. That is expected; do not fix them here.

---

### Task 3: Coordinate conversion library

**Files:**
- Create: `src/lib/coords.ts`
- Test: `src/lib/coords.test.ts`

**Interfaces:**
- Consumes: `Pt` from `src/lib/detect.ts`.
- Produces:
  - `normPolygon(poly: Pt[], procW: number, procH: number): Pt[]`
  - `denormPolygon(poly: Pt[], procW: number, procH: number): Pt[]`
  - `normCentroid(p: Pt, procW: number, procH: number): Pt` (alias of point-normalize)
  - `toViewport(p: Pt, natW: number, natH: number): Pt` — normalized → OSD viewport coords (x in [0,1], y in [0, natH/natW])
  - `fromImagePixels(p: Pt, natW: number, natH: number): Pt` — OSD image-pixel coords → normalized 0..1

- [ ] **Step 1: Write the failing test**

`src/lib/coords.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { normPolygon, denormPolygon, toViewport, fromImagePixels } from "./coords";

describe("coords", () => {
  it("normalizes proc coords to 0..1 of each axis", () => {
    expect(normPolygon([{ x: 800, y: 600 }], 1600, 1200)).toEqual([{ x: 0.5, y: 0.5 }]);
  });
  it("round-trips norm <-> proc", () => {
    const proc = [{ x: 123, y: 456 }];
    const back = denormPolygon(normPolygon(proc, 1600, 1200), 1600, 1200);
    expect(back[0].x).toBeCloseTo(123);
    expect(back[0].y).toBeCloseTo(456);
  });
  it("maps normalized to OSD viewport coords (y scaled by natH/natW)", () => {
    // 2:1 landscape image → y axis spans 0..0.5
    expect(toViewport({ x: 0.5, y: 1 }, 2000, 1000)).toEqual({ x: 0.5, y: 0.5 });
  });
  it("maps OSD image pixels to normalized 0..1", () => {
    expect(fromImagePixels({ x: 1000, y: 500 }, 2000, 1000)).toEqual({ x: 0.5, y: 0.5 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/coords.test.ts`
Expected: FAIL — `Cannot find module './coords'`.

- [ ] **Step 3: Implement `coords.ts`**

```ts
import type { Pt } from "./detect";

export function normPolygon(poly: Pt[], procW: number, procH: number): Pt[] {
  return poly.map((p) => ({ x: p.x / procW, y: p.y / procH }));
}

export function denormPolygon(poly: Pt[], procW: number, procH: number): Pt[] {
  return poly.map((p) => ({ x: p.x * procW, y: p.y * procH }));
}

export function normCentroid(p: Pt, procW: number, procH: number): Pt {
  return { x: p.x / procW, y: p.y / procH };
}

// Normalized (0..1 of each axis) -> OpenSeadragon viewport coords.
// OSD viewport x spans [0,1] across the image width; y spans [0, natH/natW].
export function toViewport(p: Pt, natW: number, natH: number): Pt {
  return { x: p.x, y: p.y * (natH / natW) };
}

// OSD image-pixel coords (0..natW, 0..natH) -> normalized 0..1 of each axis.
export function fromImagePixels(p: Pt, natW: number, natH: number): Pt {
  return { x: p.x / natW, y: p.y / natH };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/coords.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/coords.ts src/lib/coords.test.ts
git commit -m "v3-engine: coordinate conversion lib (norm <-> proc, OSD viewport/image)"
```

---

### Task 4: Slug generation library

**Files:**
- Create: `src/lib/slug.ts`
- Test: `src/lib/slug.test.ts`

**Interfaces:**
- Produces: `slugify(name: string): string`, `uniqueSlug(base: string, existing: Set<string>): string`.

- [ ] **Step 1: Write the failing test**

`src/lib/slug.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { slugify, uniqueSlug } from "./slug";

describe("slugify", () => {
  it("kebab-cases and strips punctuation", () => {
    expect(slugify("Green Valley — Phase 2!")).toBe("green-valley-phase-2");
  });
  it("falls back to 'project' for empty input", () => {
    expect(slugify("  ***  ")).toBe("project");
  });
});

describe("uniqueSlug", () => {
  it("returns base when free", () => {
    expect(uniqueSlug("green-valley", new Set())).toBe("green-valley");
  });
  it("suffixes with next free integer", () => {
    expect(uniqueSlug("green-valley", new Set(["green-valley", "green-valley-2"]))).toBe("green-valley-3");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/slug.test.ts`
Expected: FAIL — `Cannot find module './slug'`.

- [ ] **Step 3: Implement `slug.ts`**

```ts
export function slugify(name: string): string {
  const s = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s || "project";
}

export function uniqueSlug(base: string, existing: Set<string>): string {
  if (!existing.has(base)) return base;
  let i = 2;
  while (existing.has(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/slug.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/slug.ts src/lib/slug.test.ts
git commit -m "v3-engine: slug generation lib"
```

---

### Task 5: Auth token library (HMAC)

**Files:**
- Create: `src/lib/auth.ts`
- Test: `src/lib/auth.test.ts`

**Interfaces:**
- Produces: `AUTH_COOKIE` (`"plot_admin"`), `signToken(secret: string): string`, `verifyToken(secret: string, token: string | undefined): boolean`.

- [ ] **Step 1: Write the failing test**

`src/lib/auth.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { signToken, verifyToken } from "./auth";

describe("auth token", () => {
  it("verifies a token it signed", () => {
    const t = signToken("secret-a");
    expect(verifyToken("secret-a", t)).toBe(true);
  });
  it("rejects a token signed with a different secret", () => {
    const t = signToken("secret-a");
    expect(verifyToken("secret-b", t)).toBe(false);
  });
  it("rejects undefined / empty tokens", () => {
    expect(verifyToken("secret-a", undefined)).toBe(false);
    expect(verifyToken("secret-a", "")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/auth.test.ts`
Expected: FAIL — `Cannot find module './auth'`.

- [ ] **Step 3: Implement `auth.ts`**

```ts
import { createHmac, timingSafeEqual } from "crypto";

export const AUTH_COOKIE = "plot_admin";

export function signToken(secret: string): string {
  return createHmac("sha256", secret).update("admin").digest("hex");
}

export function verifyToken(secret: string, token: string | undefined): boolean {
  if (!token) return false;
  const expected = signToken(secret);
  if (token.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(token), Buffer.from(expected));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/auth.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/auth.ts src/lib/auth.test.ts
git commit -m "v3-engine: HMAC auth token lib"
```

---

### Task 6: Database layer + schema

**Files:**
- Create: `src/lib/db.ts`
- Create: `scripts/db-setup.mjs`
- Modify: `package.json` (add `"db:setup"` script)

**Interfaces:**
- Consumes: `Plot` from `src/lib/plot.ts`.
- Produces:
  - `interface ProjectRow { id: string; slug: string; name: string; natW: number; natH: number; imageUrl: string | null; dziUrl: string | null; plots: Plot[]; status: "draft" | "published"; updatedAt: number }`
  - `ensureSchema(): Promise<void>`
  - `listProjects(): Promise<ProjectRow[]>`
  - `getProject(id: string): Promise<ProjectRow | null>`
  - `getProjectBySlug(slug: string): Promise<ProjectRow | null>`
  - `createProject(input: { slug: string; name: string; natW: number; natH: number; plots: Plot[] }): Promise<ProjectRow>`
  - `updateProject(id: string, patch: Partial<Pick<ProjectRow, "name" | "slug" | "status" | "plots" | "imageUrl" | "dziUrl" | "natW" | "natH">>): Promise<ProjectRow | null>`
  - `deleteProject(id: string): Promise<void>`

- [ ] **Step 1: Implement `db.ts`**

> No unit test here (requires a live Postgres). Verified via `db-setup.mjs` + a curl round-trip in Task 8. Keep the row-mapping in one helper so Task 8's tests exercise it indirectly.

```ts
import { sql } from "@vercel/postgres";
import type { Plot } from "./plot";

export interface ProjectRow {
  id: string;
  slug: string;
  name: string;
  natW: number;
  natH: number;
  imageUrl: string | null;
  dziUrl: string | null;
  plots: Plot[];
  status: "draft" | "published";
  updatedAt: number;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function mapRow(r: any): ProjectRow {
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    natW: r.nat_w,
    natH: r.nat_h,
    imageUrl: r.image_url,
    dziUrl: r.dzi_url,
    plots: (r.plots ?? []) as Plot[],
    status: r.status,
    updatedAt: new Date(r.updated_at).getTime(),
  };
}

export async function ensureSchema(): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS projects (
      id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      slug       text UNIQUE NOT NULL,
      name       text NOT NULL,
      nat_w      int NOT NULL,
      nat_h      int NOT NULL,
      image_url  text,
      dzi_url    text,
      plots      jsonb NOT NULL DEFAULT '[]'::jsonb,
      status     text NOT NULL DEFAULT 'draft',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
  `;
}

export async function listProjects(): Promise<ProjectRow[]> {
  const { rows } = await sql`SELECT * FROM projects ORDER BY updated_at DESC;`;
  return rows.map(mapRow);
}

export async function getProject(id: string): Promise<ProjectRow | null> {
  const { rows } = await sql`SELECT * FROM projects WHERE id = ${id};`;
  return rows[0] ? mapRow(rows[0]) : null;
}

export async function getProjectBySlug(slug: string): Promise<ProjectRow | null> {
  const { rows } = await sql`SELECT * FROM projects WHERE slug = ${slug};`;
  return rows[0] ? mapRow(rows[0]) : null;
}

export async function createProject(input: {
  slug: string;
  name: string;
  natW: number;
  natH: number;
  plots: Plot[];
}): Promise<ProjectRow> {
  const { rows } = await sql`
    INSERT INTO projects (slug, name, nat_w, nat_h, plots)
    VALUES (${input.slug}, ${input.name}, ${input.natW}, ${input.natH}, ${JSON.stringify(input.plots)}::jsonb)
    RETURNING *;
  `;
  return mapRow(rows[0]);
}

export async function updateProject(
  id: string,
  patch: Partial<Pick<ProjectRow, "name" | "slug" | "status" | "plots" | "imageUrl" | "dziUrl" | "natW" | "natH">>
): Promise<ProjectRow | null> {
  // COALESCE keeps existing values when a field is omitted (undefined -> null param).
  const { rows } = await sql`
    UPDATE projects SET
      name       = COALESCE(${patch.name ?? null}, name),
      slug       = COALESCE(${patch.slug ?? null}, slug),
      status     = COALESCE(${patch.status ?? null}, status),
      nat_w      = COALESCE(${patch.natW ?? null}, nat_w),
      nat_h      = COALESCE(${patch.natH ?? null}, nat_h),
      image_url  = COALESCE(${patch.imageUrl ?? null}, image_url),
      dzi_url    = COALESCE(${patch.dziUrl ?? null}, dzi_url),
      plots      = COALESCE(${patch.plots ? JSON.stringify(patch.plots) : null}::jsonb, plots),
      updated_at = now()
    WHERE id = ${id}
    RETURNING *;
  `;
  return rows[0] ? mapRow(rows[0]) : null;
}

export async function deleteProject(id: string): Promise<void> {
  await sql`DELETE FROM projects WHERE id = ${id};`;
}
```

> Verify at execution: `@vercel/postgres` `sql` tagged-template signature against `node_modules/@vercel/postgres`. `gen_random_uuid()` is built into Postgres 13+ (Vercel/Neon), no extension needed.

- [ ] **Step 2: Create `scripts/db-setup.mjs`**

```js
import { config } from "dotenv";
config({ path: ".env.local" });
const { ensureSchema } = await import("../src/lib/db.ts");
await ensureSchema();
console.log("schema ready");
process.exit(0);
```

Add to `package.json` scripts:
```json
"db:setup": "node --experimental-strip-types scripts/db-setup.mjs"
```
Install the loader helper: `npm install -D dotenv`.

- [ ] **Step 3: Run schema setup against your Vercel Postgres**

Prereq: `.env.local` has a valid `POSTGRES_URL` (from `vercel env pull` or the Vercel Storage tab).
Run: `npm run db:setup`
Expected: prints `schema ready`. If `node --experimental-strip-types` cannot import the `.ts`, instead inline the `CREATE TABLE` SQL into `db-setup.mjs` using `import { sql } from "@vercel/postgres"` and the same statement.

- [ ] **Step 4: Verify the table exists**

Run: `npx vercel env pull` (if not already) then query, e.g. with `psql "$POSTGRES_URL" -c '\d projects'` or via the Vercel dashboard SQL editor.
Expected: `projects` table with the columns above.

- [ ] **Step 5: Commit**

```bash
git add src/lib/db.ts scripts/db-setup.mjs package.json package-lock.json
git commit -m "v3-engine: Postgres layer (projects table + CRUD) and db:setup script"
```

---

### Task 7: Login/logout routes + `proxy.ts` guard

**Files:**
- Create: `src/app/api/admin/login/route.ts`
- Create: `src/app/api/admin/logout/route.ts`
- Create: `proxy.ts` (project root)

**Interfaces:**
- Consumes: `signToken`, `verifyToken`, `AUTH_COOKIE` from `src/lib/auth.ts`.
- Produces: cookie `plot_admin` (httpOnly) set on login; the `proxy` guard protecting `/admin/*` (except `/admin/login`) and `/api/projects/*`, `/api/blob/*`.

- [ ] **Step 1: Implement the login route**

`src/app/api/admin/login/route.ts`:
```ts
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { signToken, AUTH_COOKIE } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const { password } = (await request.json()) as { password?: string };
  if (!password || password !== process.env.ADMIN_PASSWORD) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const store = await cookies();
  store.set(AUTH_COOKIE, signToken(process.env.AUTH_SECRET!), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Implement the logout route**

`src/app/api/admin/logout/route.ts`:
```ts
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { AUTH_COOKIE } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST() {
  const store = await cookies();
  store.delete(AUTH_COOKIE);
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3: Implement `proxy.ts` (project root — NOT `middleware.ts`)**

```ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { verifyToken, AUTH_COOKIE } from "@/lib/auth";

// Paths under the matcher that must stay reachable while logged out.
const PUBLIC_PATHS = new Set(["/admin/login"]);

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (PUBLIC_PATHS.has(pathname)) return NextResponse.next();

  const token = request.cookies.get(AUTH_COOKIE)?.value;
  if (verifyToken(process.env.AUTH_SECRET!, token)) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.redirect(new URL("/admin/login", request.url));
}

export const config = {
  matcher: ["/admin/:path*", "/api/projects/:path*", "/api/blob/:path*"],
};
```

> `/api/admin/login` and `/api/admin/logout` are intentionally NOT in the matcher (login must work while logged out; logout clears its own cookie).

- [ ] **Step 4: Verify the guard end-to-end**

Run in one terminal: `npm run dev`
In another:
```bash
# Blocked without cookie:
curl -i -X POST http://localhost:3000/api/projects -H 'content-type: application/json' -d '{}'
# Expect: HTTP/1.1 401  {"error":"unauthorized"}

# Wrong password:
curl -i -X POST http://localhost:3000/api/admin/login -H 'content-type: application/json' -d '{"password":"nope"}'
# Expect: HTTP/1.1 401

# Correct password (use your ADMIN_PASSWORD), capture cookie:
curl -i -c /tmp/pv.txt -X POST http://localhost:3000/api/admin/login -H 'content-type: application/json' -d '{"password":"<ADMIN_PASSWORD>"}'
# Expect: HTTP/1.1 200 and a Set-Cookie: plot_admin=...; HttpOnly
```

- [ ] **Step 5: Commit**

```bash
git add src/app/api/admin proxy.ts
git commit -m "v3-engine: server auth — login/logout routes + proxy guard (Next 16)"
```

---

### Task 8: Project CRUD API routes

**Files:**
- Create: `src/app/api/projects/route.ts`
- Create: `src/app/api/projects/[id]/route.ts`

**Interfaces:**
- Consumes: `db.ts` functions; `slugify`, `uniqueSlug` from `src/lib/slug.ts`.
- Produces:
  - `POST /api/projects` body `{ name: string; natW: number; natH: number; plots?: Plot[] }` → `201 { project: ProjectRow }` (auto-generates a unique slug).
  - `GET /api/projects` → `200 { projects: ProjectRow[] }`.
  - `PATCH /api/projects/[id]` body = partial `{ name?, slug?, status?, plots?, imageUrl?, dziUrl?, natW?, natH? }` → `200 { project }` or `404`.
  - `DELETE /api/projects/[id]` → `200 { ok: true }`.

- [ ] **Step 1: Implement the collection route**

`src/app/api/projects/route.ts`:
```ts
import { NextResponse } from "next/server";
import { createProject, listProjects } from "@/lib/db";
import { slugify, uniqueSlug } from "@/lib/slug";
import type { Plot } from "@/lib/plot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const projects = await listProjects();
  return NextResponse.json({ projects });
}

export async function POST(request: Request) {
  const body = (await request.json()) as {
    name?: string;
    natW?: number;
    natH?: number;
    plots?: Plot[];
  };
  if (!body.name || !body.natW || !body.natH) {
    return NextResponse.json({ error: "name, natW, natH required" }, { status: 400 });
  }
  const existing = new Set((await listProjects()).map((p) => p.slug));
  const slug = uniqueSlug(slugify(body.name), existing);
  const project = await createProject({
    slug,
    name: body.name,
    natW: body.natW,
    natH: body.natH,
    plots: body.plots ?? [],
  });
  return NextResponse.json({ project }, { status: 201 });
}
```

- [ ] **Step 2: Implement the item route**

`src/app/api/projects/[id]/route.ts`:
```ts
import { NextResponse } from "next/server";
import { getProject, updateProject, deleteProject } from "@/lib/db";
import type { ProjectRow } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const patch = (await request.json()) as Partial<
    Pick<ProjectRow, "name" | "slug" | "status" | "plots" | "imageUrl" | "dziUrl" | "natW" | "natH">
  >;
  const project = await updateProject(id, patch);
  if (!project) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ project });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const existing = await getProject(id);
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
  await deleteProject(id);
  return NextResponse.json({ ok: true });
}
```

> Blob-object cleanup on delete is added in Task 12 (once tiling exists).

- [ ] **Step 3: Verify CRUD with the auth cookie from Task 7**

With `npm run dev` running and `/tmp/pv.txt` holding the login cookie:
```bash
# Create:
curl -s -b /tmp/pv.txt -X POST http://localhost:3000/api/projects \
  -H 'content-type: application/json' \
  -d '{"name":"Green Valley Phase 2","natW":4000,"natH":3000,"plots":[]}' | tee /tmp/proj.json
# Expect: {"project":{"id":"...","slug":"green-valley-phase-2",...}}

# List:
curl -s -b /tmp/pv.txt http://localhost:3000/api/projects
# Expect: {"projects":[{...}]}

# Patch status (extract id from /tmp/proj.json):
ID=$(node -e "console.log(require('/tmp/proj.json').project.id)")
curl -s -b /tmp/pv.txt -X PATCH http://localhost:3000/api/projects/$ID \
  -H 'content-type: application/json' -d '{"status":"published"}'
# Expect: {"project":{...,"status":"published"}}
```

- [ ] **Step 4: Run the full unit suite (guard against regressions)**

Run: `npx vitest run`
Expected: PASS (plot, coords, slug, auth, detect).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/projects
git commit -m "v3-engine: project CRUD API routes"
```

---

### Task 9: Admin login page + projects list

**Files:**
- Create: `src/app/admin/login/page.tsx`
- Rewrite: `src/app/admin/page.tsx` (server component — projects list)
- Create: `src/components/AdminProjectsList.tsx` (client — actions)
- Delete: `src/components/AdminGate.tsx`, `src/components/AdminClient.tsx`
- Modify: `src/app/page.tsx` (point "Admin" link to `/admin`, unchanged target but remove reliance on gate)

**Interfaces:**
- Consumes: `GET/POST /api/projects`, `DELETE/PATCH /api/projects/[id]`, `POST /api/admin/login`, `listProjects` (server-side in the page).
- Produces: `/admin` renders the project list for authenticated operators; unauthenticated users are redirected to `/admin/login` by `proxy.ts`.

- [ ] **Step 1: Login page**

`src/app/admin/login/page.tsx`:
```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [pw, setPw] = useState("");
  const [err, setErr] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch("/api/admin/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: pw }),
    });
    if (res.ok) router.push("/admin");
    else setErr(true);
  }

  return (
    <main className="mx-auto mt-20 max-w-sm px-6">
      <form onSubmit={submit} className="flex flex-col gap-3 rounded-lg border border-neutral-200 p-6">
        <h1 className="text-lg font-semibold">Admin login</h1>
        <input
          type="password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          placeholder="Password"
          autoFocus
          className="rounded border border-neutral-300 px-3 py-2"
        />
        {err && <p className="text-sm text-red-600">Wrong password.</p>}
        <button className="rounded bg-blue-600 px-3 py-2 font-medium text-white">Enter</button>
      </form>
    </main>
  );
}
```

- [ ] **Step 2: Projects list page (server component)**

Rewrite `src/app/admin/page.tsx`:
```tsx
import Link from "next/link";
import { listProjects } from "@/lib/db";
import AdminProjectsList from "@/components/AdminProjectsList";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const projects = await listProjects();
  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <header className="mb-6 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">Projects</h1>
        <div className="flex items-center gap-3">
          <Link href="/" className="text-sm text-neutral-600 underline hover:text-neutral-900">
            View site
          </Link>
          <form action="/api/admin/logout" method="post">
            <button className="text-xs text-neutral-500 underline hover:text-neutral-800">Log out</button>
          </form>
        </div>
      </header>
      <AdminProjectsList
        initial={projects.map((p) => ({
          id: p.id,
          name: p.name,
          slug: p.slug,
          status: p.status,
          count: p.plots.length,
        }))}
      />
    </main>
  );
}
```

> The logout `<form method="post">` posts to `/api/admin/logout`; add a `GET` handler there too if you prefer a link, or keep as a button.

- [ ] **Step 3: Projects list client (create / publish / copy link / delete)**

`src/components/AdminProjectsList.tsx`:
```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

interface Item {
  id: string;
  name: string;
  slug: string;
  status: "draft" | "published";
  count: number;
}

export default function AdminProjectsList({ initial }: { initial: Item[] }) {
  const router = useRouter();
  const [items, setItems] = useState(initial);
  const [name, setName] = useState("");

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    // Placeholder dims; real dims are set when a map is uploaded in the editor.
    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, natW: 1, natH: 1, plots: [] }),
    });
    const { project } = await res.json();
    router.push(`/admin/${project.id}`);
  }

  async function togglePublish(it: Item) {
    const next = it.status === "published" ? "draft" : "published";
    await fetch(`/api/projects/${it.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: next }),
    });
    setItems((xs) => xs.map((x) => (x.id === it.id ? { ...x, status: next } : x)));
  }

  async function remove(it: Item) {
    if (!confirm(`Delete "${it.name}"? This cannot be undone.`)) return;
    await fetch(`/api/projects/${it.id}`, { method: "DELETE" });
    setItems((xs) => xs.filter((x) => x.id !== it.id));
  }

  function copyLink(slug: string) {
    navigator.clipboard.writeText(`${location.origin}/p/${slug}`);
  }

  return (
    <div className="flex flex-col gap-6">
      <form onSubmit={create} className="flex flex-wrap gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="New project name"
          className="min-w-0 flex-1 rounded border border-neutral-300 px-3 py-2"
        />
        <button className="rounded bg-blue-600 px-4 py-2 font-medium text-white">Create project</button>
      </form>

      {items.length === 0 ? (
        <p className="text-neutral-500">No projects yet. Create one above.</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((it) => (
            <li key={it.id} className="flex flex-col gap-3 rounded-lg border border-neutral-200 p-4">
              <div className="flex items-start justify-between gap-2">
                <Link href={`/admin/${it.id}`} className="font-semibold hover:underline">
                  {it.name}
                </Link>
                <span
                  className={`rounded px-2 py-0.5 text-xs ${
                    it.status === "published" ? "bg-green-100 text-green-700" : "bg-neutral-100 text-neutral-600"
                  }`}
                >
                  {it.status}
                </span>
              </div>
              <p className="text-xs text-neutral-500">{it.count} plots · /p/{it.slug}</p>
              <div className="mt-auto flex flex-wrap gap-2 text-xs">
                <button onClick={() => togglePublish(it)} className="rounded border border-neutral-300 px-2 py-1">
                  {it.status === "published" ? "Unpublish" : "Publish"}
                </button>
                <button onClick={() => copyLink(it.slug)} className="rounded border border-neutral-300 px-2 py-1">
                  Copy link
                </button>
                <button onClick={() => remove(it)} className="rounded bg-red-50 px-2 py-1 text-red-600">
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Delete the obsolete gate/client and verify build**

Run:
```bash
git rm src/components/AdminGate.tsx src/components/AdminClient.tsx
npm run build
```
Expected: build succeeds. If `PlotEditor.tsx`/`PublicViewer.tsx` break the build (they still import removed `saveProject`/`loadProject`), that is expected — they are migrated in Tasks 10 and 13. To keep the build green between tasks, temporarily leave `/admin/[id]` and `/` pointing only at compiling code; the editor route is created in Task 10. If needed, comment the `<PublicClient/>` usage on `/` until Task 13. Note this in the commit.

- [ ] **Step 5: Commit**

```bash
git add src/app/admin src/components/AdminProjectsList.tsx
git commit -m "v3-engine: admin login page + projects list (create/publish/copy/delete)"
```

---

### Task 10: Migrate the editor to the database

**Files:**
- Create: `src/app/admin/[id]/page.tsx`
- Create: `src/lib/api.ts` (client fetch helpers)
- Rewrite: `src/components/PlotEditor.tsx` (load/save via API; normalize coords at the DB boundary; keep legacy `PlotMap` for now)

**Interfaces:**
- Consumes: `PATCH /api/projects/[id]`, `getProject` (server-side in the page), `normPolygon`/`denormPolygon`/`normCentroid` from `coords.ts`, `PlotMap`.
- Produces: `saveProjectPatch(id, patch)` in `api.ts`; `PlotEditor` now takes a `projectId` prop and persists plots (normalized) to the DB.

- [ ] **Step 1: Client API helper**

`src/lib/api.ts`:
```ts
import type { Plot } from "./plot";
import type { ProjectRow } from "./db";

export type ProjectPatch = Partial<
  Pick<ProjectRow, "name" | "slug" | "status" | "plots" | "imageUrl" | "dziUrl" | "natW" | "natH">
>;

export async function saveProjectPatch(id: string, patch: ProjectPatch): Promise<ProjectRow> {
  const res = await fetch(`/api/projects/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`save failed: ${res.status}`);
  const { project } = await res.json();
  return project as ProjectRow;
}
```

- [ ] **Step 2: Editor route (server component loads the project)**

`src/app/admin/[id]/page.tsx`:
```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { getProject } from "@/lib/db";
import PlotEditor from "@/components/PlotEditor";

export const dynamic = "force-dynamic";

export default async function EditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) notFound();
  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <header className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{project.name}</h1>
          <p className="text-sm text-neutral-600">/p/{project.slug}</p>
        </div>
        <Link href="/admin" className="text-sm text-neutral-600 underline hover:text-neutral-900">
          ← All projects
        </Link>
      </header>
      <PlotEditor
        projectId={project.id}
        initialImageUrl={project.imageUrl}
        initialNat={{ w: project.natW, h: project.natH }}
        initialPlots={project.plots}
      />
    </main>
  );
}
```

- [ ] **Step 3: Rewrite `PlotEditor.tsx` to persist to the DB**

Key changes from the current file (`src/components/PlotEditor.tsx`):
1. Add props: `projectId: string; initialImageUrl: string | null; initialNat: {w:number;h:number}; initialPlots: Plot[]`.
2. Delete the `idb` imports and `loadProject`/`saveProject`/`clearProject` usage. Import `saveProjectPatch` from `@/lib/api` and `normPolygon`, `denormPolygon`, `normCentroid` from `@/lib/coords`.
3. Initialize state from props. **Plots arrive normalized**; convert to proc coords for the legacy `PlotMap` on load, and normalize back on every save.
4. `persist(nextPlots)` now calls the API with normalized plots + current `natW/natH`.

Replace the file with:
```tsx
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { detectPlots, type Pt } from "@/lib/detect";
import PlotMap from "@/components/PlotMap";
import { saveProjectPatch } from "@/lib/api";
import { normPolygon, denormPolygon, normCentroid } from "@/lib/coords";
import {
  PROC_MAX,
  STATUS,
  STATUS_ORDER,
  countByStatus,
  fit,
  type Plot,
  type Status,
} from "@/lib/plot";

function isHeic(file: File) {
  return /heic|heif/i.test(file.type) || /\.(heic|heif)$/i.test(file.name);
}

interface Props {
  projectId: string;
  initialImageUrl: string | null;
  initialNat: { w: number; h: number };
  initialPlots: Plot[]; // normalized 0..1
}

export default function PlotEditor({ projectId, initialImageUrl, initialNat, initialPlots }: Props) {
  const [imgUrl, setImgUrl] = useState<string | null>(initialImageUrl);
  const [nat, setNat] = useState(initialNat);
  // proc = detection resolution used for the legacy PlotMap overlay
  const [proc, setProc] = useState(() => fit(initialNat.w || 1, initialNat.h || 1, PROC_MAX, PROC_MAX));
  // Plots held in PROC coords for PlotMap; normalized on save.
  const [plots, setPlots] = useState<Plot[]>(() =>
    initialPlots.map((p) => ({
      ...p,
      polygon: denormPolygon(p.polygon, proc0(initialNat).w, proc0(initialNat).h),
      centroid: denormPolygon([p.centroid], proc0(initialNat).w, proc0(initialNat).h)[0],
    }))
  );
  const [threshold, setThreshold] = useState<number>(-1);
  const [invert, setInvert] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [addMode, setAddMode] = useState(false);
  const [tilt, setTilt] = useState(0);
  const imgRef = useRef<HTMLImageElement | null>(null);

  function proc0(n: { w: number; h: number }) {
    return fit(n.w || 1, n.h || 1, PROC_MAX, PROC_MAX);
  }

  useEffect(() => {
    if (!initialImageUrl) return;
    const image = new window.Image();
    image.crossOrigin = "anonymous";
    image.onload = () => { imgRef.current = image; };
    image.src = initialImageUrl;
  }, [initialImageUrl]);

  const persist = useCallback(
    async (nextPlots: Plot[]) => {
      const normalized = nextPlots.map((p) => ({
        ...p,
        polygon: normPolygon(p.polygon, proc.w, proc.h),
        centroid: normCentroid(p.centroid, proc.w, proc.h),
      }));
      await saveProjectPatch(projectId, { plots: normalized, natW: nat.w, natH: nat.h });
      setSavedAt(Date.now());
    },
    [projectId, proc, nat]
  );

  const runDetect = useCallback(
    (image: HTMLImageElement, pw: number, ph: number, t: number, inv: boolean): Plot[] => {
      const canvas = document.createElement("canvas");
      canvas.width = pw;
      canvas.height = ph;
      const ctx = canvas.getContext("2d");
      if (!ctx) return [];
      ctx.drawImage(image, 0, 0, pw, ph);
      const data = ctx.getImageData(0, 0, pw, ph);
      const found = detectPlots(
        { data: data.data, width: pw, height: ph },
        { threshold: t < 0 ? undefined : t, invert: inv, minAreaFrac: 0.0003, maxAreaFrac: 0.12 }
      );
      return found.map((p, i) => ({
        id: i + 1,
        num: String(i + 1),
        polygon: p.polygon,
        centroid: p.centroid,
        status: "available" as Status,
      }));
    },
    []
  );

  // NOTE: uploading the image to Blob + tiling is wired in Tasks 11/12.
  // For now, load the image locally to run detection and save plots + dims.
  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy("Loading image…");
    try {
      let blob: Blob = file;
      if (isHeic(file)) {
        setBusy("Converting HEIC…");
        const heic2any = (await import("heic2any")).default;
        const out = await heic2any({ blob: file, toType: "image/png" });
        blob = Array.isArray(out) ? out[0] : out;
      }
      const url = URL.createObjectURL(blob);
      const image = new window.Image();
      image.onload = () => {
        const pr = fit(image.width, image.height, PROC_MAX, PROC_MAX);
        imgRef.current = image;
        setImgUrl(url);
        setNat({ w: image.width, h: image.height });
        setProc({ w: pr.w, h: pr.h, scale: pr.scale });
        setAddMode(false);
        setBusy("Detecting plots…");
        setTimeout(async () => {
          const next = runDetect(image, pr.w, pr.h, threshold, invert);
          setPlots(next);
          const normalized = next.map((p) => ({
            ...p,
            polygon: normPolygon(p.polygon, pr.w, pr.h),
            centroid: normCentroid(p.centroid, pr.w, pr.h),
          }));
          await saveProjectPatch(projectId, { plots: normalized, natW: image.width, natH: image.height });
          setSavedAt(Date.now());
          setBusy(null);
        }, 0);
      };
      image.onerror = () => setBusy("Could not load that image.");
      image.src = url;
    } catch {
      setBusy("HEIC conversion failed — try a PNG or JPG.");
    }
    e.target.value = "";
  }

  function redetect() {
    if (!imgRef.current) return;
    setBusy("Detecting plots…");
    setTimeout(async () => {
      const next = runDetect(imgRef.current!, proc.w, proc.h, threshold, invert);
      setPlots(next);
      await persist(next);
      setBusy(null);
    }, 0);
  }

  function addPlot(polygon: Pt[]) {
    let cx = 0, cy = 0;
    for (const pt of polygon) { cx += pt.x; cy += pt.y; }
    setPlots((prev) => {
      const nextId = prev.reduce((m, p) => Math.max(m, p.id), 0) + 1;
      const next = [...prev, {
        id: nextId, num: "", polygon,
        centroid: { x: cx / polygon.length, y: cy / polygon.length },
        status: "available" as Status,
      }];
      void persist(next);
      return next;
    });
  }

  function setStatus(id: number, status: Status) {
    setPlots((prev) => {
      const next = prev.map((p) => (p.id === id ? { ...p, status } : p));
      void persist(next);
      return next;
    });
  }

  function removePlot(id: number) {
    setPlots((prev) => {
      const next = prev.filter((p) => p.id !== id);
      void persist(next);
      return next;
    });
  }

  const counts = countByStatus(plots);

  if (!imgUrl) {
    return (
      <label className="mx-auto flex max-w-xl cursor-pointer flex-col items-center gap-3 rounded-xl border-2 border-dashed border-neutral-300 bg-neutral-50 p-12 text-center hover:border-blue-400 hover:bg-blue-50/40">
        <span className="text-lg font-medium text-neutral-700">{busy ?? "Upload a plot layout map"}</span>
        <span className="text-sm text-neutral-500">PNG, JPG, or HEIC. Plots are detected automatically.</span>
        <span className="mt-1 rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white">Choose file</span>
        <input type="file" accept="image/*,.heic,.heif" onChange={onFile} className="hidden" />
      </label>
    );
  }

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setAddMode((v) => !v)}
            className={`rounded px-3 py-2 text-sm font-medium ${addMode ? "bg-blue-600 text-white" : "border border-blue-600 text-blue-700"}`}
          >
            {addMode ? "Done adding" : "+ Add plot box"}
          </button>
          {addMode && (
            <label className="flex items-center gap-2 rounded border border-neutral-200 px-2 py-1 text-xs text-neutral-600">
              Tilt
              <input type="range" min={-45} max={45} value={tilt} onChange={(e) => setTilt(Number(e.target.value))} />
              <span className="w-8 tabular-nums">{tilt}°</span>
            </label>
          )}
          <span className="ml-auto flex items-center gap-3 text-xs text-neutral-500">
            {savedAt && <span className="text-green-700">Saved ✓</span>}
            <label className="cursor-pointer underline hover:text-neutral-800">
              Replace map
              <input type="file" accept="image/*,.heic,.heif" onChange={onFile} className="hidden" />
            </label>
          </span>
        </div>

        <PlotMap
          imgUrl={imgUrl}
          procW={proc.w}
          procH={proc.h}
          plots={plots}
          onSetStatus={setStatus}
          onDeletePlot={removePlot}
          addMode={addMode}
          onAddPlot={addPlot}
          tilt={(tilt * Math.PI) / 180}
        />

        <p className="text-xs text-neutral-500">
          {addMode
            ? "Add mode: drag a box around a plot the detector missed."
            : "Click a plot to set its status or delete it. Changes save automatically."}
        </p>
      </div>

      <div className="flex w-full shrink-0 flex-col gap-4 text-sm lg:w-72">
        <div className="rounded-lg border border-neutral-200 p-4">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="font-semibold">Plots</h2>
            <span className="text-3xl font-bold">{plots.length}</span>
          </div>
          <div className="flex flex-col gap-2">
            {STATUS_ORDER.map((s) => (
              <div key={s} className="flex items-center gap-2">
                <span className="inline-block h-3.5 w-3.5 rounded-sm" style={{ backgroundColor: STATUS[s].color }} />
                <span className="text-neutral-600">{STATUS[s].label}</span>
                <span className="ml-auto font-semibold tabular-nums">{counts[s]}</span>
              </div>
            ))}
          </div>
        </div>

        <details className="rounded-lg border border-neutral-200 p-3">
          <summary className="cursor-pointer font-semibold">Detection settings</summary>
          <div className="mt-3 flex flex-col gap-3">
            <label className="flex items-center justify-between gap-2">
              <span className="text-neutral-600">Sensitivity {threshold < 0 ? "(auto)" : threshold}</span>
              <input type="range" min={-1} max={255} value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} />
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={invert} onChange={(e) => setInvert(e.target.checked)} />
              <span className="text-neutral-600">Invert (plots darker than background)</span>
            </label>
            <button onClick={redetect} disabled={!!busy} className="rounded bg-neutral-800 px-3 py-2 text-white disabled:opacity-40">
              {busy ?? "Re-detect"}
            </button>
          </div>
        </details>
      </div>
    </div>
  );
}
```

> This keeps detection + the legacy `PlotMap` intact and working; only persistence moved to the DB. The Blob upload + deep-zoom swap happen in Phase 2, which replaces `onFile`'s local-URL image and `PlotMap` with Blob + `DeepZoomMap`.

- [ ] **Step 4: Verify editor round-trip**

Run: `npm run build` then `npm run dev`.
- Log in at `/admin/login`, create a project → lands on `/admin/[id]`.
- Upload a plot image → plots detect and render on `PlotMap`; "Saved ✓" appears.
- Reload the page → plots persist (loaded from DB, denormalized onto `PlotMap`).
- `curl -s -b /tmp/pv.txt http://localhost:3000/api/projects` shows the project with a non-empty `plots` array of normalized coords (values between 0 and 1).

- [ ] **Step 5: Commit**

```bash
git add src/app/admin/[id] src/lib/api.ts src/components/PlotEditor.tsx
git commit -m "v3-engine: editor persists to Postgres (normalized coords), per-project route"
```

---

# Phase 2 — Deep-Zoom

Outcome: original images live in Vercel Blob, a `sharp` tile pyramid is generated on upload, and both the editor and the public viewer render an OpenSeadragon deep-zoom map with an SVG plot overlay.

### Task 11: Blob client-upload token route + editor upload wiring

**Files:**
- Create: `src/app/api/blob/upload/route.ts`
- Modify: `src/components/PlotEditor.tsx` (`onFile`: after detection, upload the original to Blob and PATCH `imageUrl`)

**Interfaces:**
- Consumes: `@vercel/blob/client` `handleUpload` (server) and `upload` (client).
- Produces: `POST /api/blob/upload` (client-upload token endpoint, pins pathname to `projects/<id>/original.<ext>`); editor sets `imageUrl` on the project after upload.

- [ ] **Step 1: Token route**

`src/app/api/blob/upload/route.ts`:
```ts
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = (await request.json()) as HandleUploadBody;
  try {
    const json = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async () => ({
        addRandomSuffix: false,
        allowedContentTypes: ["image/png", "image/jpeg", "image/webp"],
        maximumSizeInBytes: 50 * 1024 * 1024,
      }),
      onUploadCompleted: async () => {
        /* no-op: editor PATCHes imageUrl after upload resolves */
      },
    });
    return NextResponse.json(json);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
```
> Verify at execution: `handleUpload`/`HandleUploadBody` import path and option names against `node_modules/@vercel/blob/client`. This route is matched by `proxy.ts` (`/api/blob/*`) so only authenticated operators can mint upload tokens.

- [ ] **Step 2: Upload the original in `onFile`**

In `src/components/PlotEditor.tsx`, add near the top:
```ts
import { upload } from "@vercel/blob/client";
```
Inside `onFile`, after `blob` is finalized (post-HEIC) and dimensions/plots are computed, add the Blob upload + `imageUrl` PATCH. Replace the `setTimeout(async () => { ... })` body so that after saving plots it also uploads:
```ts
setTimeout(async () => {
  const next = runDetect(image, pr.w, pr.h, threshold, invert);
  setPlots(next);
  const normalized = next.map((p) => ({
    ...p,
    polygon: normPolygon(p.polygon, pr.w, pr.h),
    centroid: normCentroid(p.centroid, pr.w, pr.h),
  }));
  await saveProjectPatch(projectId, { plots: normalized, natW: image.width, natH: image.height });

  setBusy("Uploading map…");
  const ext = (blob.type.split("/")[1] || "png").replace("jpeg", "jpg");
  const put = await upload(`projects/${projectId}/original.${ext}`, blob, {
    access: "public",
    handleUploadUrl: "/api/blob/upload",
  });
  await saveProjectPatch(projectId, { imageUrl: put.url });
  setImgUrl(put.url);
  setSavedAt(Date.now());
  setBusy(null);
}, 0);
```

- [ ] **Step 3: Verify upload**

Run `npm run dev`, log in, open a project, upload a map.
- Watch Network: a PUT to `*.blob.vercel-storage.com/projects/<id>/original.<ext>` succeeds.
- `curl -s -b /tmp/pv.txt http://localhost:3000/api/projects` shows the project with `imageUrl` set to the Blob URL.
- The Vercel dashboard Blob store shows `projects/<id>/original.<ext>` (no random suffix).

- [ ] **Step 4: Commit**

```bash
git add src/app/api/blob/upload/route.ts src/components/PlotEditor.tsx
git commit -m "v3-engine: client Blob upload of original image + imageUrl persistence"
```

---

### Task 12: Tiling route (`sharp` → Blob) + trigger + delete cleanup

**Files:**
- Create: `src/app/api/projects/[id]/tile/route.ts`
- Modify: `src/components/PlotEditor.tsx` (trigger tiling after upload; surface "preparing deep zoom")
- Modify: `src/app/api/projects/[id]/route.ts` (DELETE also removes Blob objects)

**Interfaces:**
- Consumes: `sharp`, `@vercel/blob` `put`/`del`/`list`, `getProject`/`updateProject`.
- Produces: `POST /api/projects/[id]/tile` → generates DZI tiles, uploads them, sets `dziUrl`, returns `{ dziUrl }`.

- [ ] **Step 1: Tiling route**

`src/app/api/projects/[id]/tile/route.ts`:
```ts
import { NextResponse } from "next/server";
import { put } from "@vercel/blob";
import sharp from "sharp";
import { mkdtemp, readFile, readdir, stat } from "fs/promises";
import { tmpdir } from "os";
import { join, relative } from "path";
import { getProject, updateProject } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 300; // seconds — raise/lower per your Vercel plan

async function* walk(dir: string): AsyncGenerator<string> {
  for (const entry of await readdir(dir)) {
    const full = join(dir, entry);
    if ((await stat(full)).isDirectory()) yield* walk(full);
    else yield full;
  }
}

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project?.imageUrl) {
    return NextResponse.json({ error: "no image to tile" }, { status: 400 });
  }

  const buf = Buffer.from(await (await fetch(project.imageUrl)).arrayBuffer());
  const workDir = await mkdtemp(join(tmpdir(), `pv-${id}-`));
  const outBase = join(workDir, "dz"); // sharp writes dz.dzi + dz_files/

  await sharp(buf)
    .webp({ quality: 80 })
    .tile({ size: 512, overlap: 1, layout: "dzi" })
    .toFile(`${outBase}.dzi`);

  // Upload dz.dzi and every dz_files/** tile, preserving relative paths.
  let dziUrl = "";
  for await (const file of walk(workDir)) {
    const rel = relative(workDir, file); // e.g. "dz.dzi" or "dz_files/10/0_0.webp"
    const data = await readFile(file);
    const contentType = rel.endsWith(".dzi") ? "application/xml" : "image/webp";
    const uploaded = await put(`projects/${id}/${rel}`, data, {
      access: "public",
      addRandomSuffix: false,
      contentType,
    });
    if (rel === "dz.dzi") dziUrl = uploaded.url;
  }

  await updateProject(id, { dziUrl });
  return NextResponse.json({ dziUrl });
}
```
> Verify at execution: `sharp(...).tile({ layout: 'dzi' })` output naming and that chaining `.webp()` yields webp tiles, against `node_modules/sharp`. If `sharp` fails to install on your platform, run `npm rebuild sharp`. If tiling exceeds the plan's function limit on very large maps, lower `size`, or move tiling to a queued job (roadmap).

- [ ] **Step 2: Trigger tiling from the editor**

In `PlotEditor.tsx`, right after `await saveProjectPatch(projectId, { imageUrl: put.url })`:
```ts
setBusy("Preparing deep zoom…");
const tileRes = await fetch(`/api/projects/${projectId}/tile`, { method: "POST" });
if (tileRes.ok) {
  const { dziUrl } = await tileRes.json();
  setDziUrl(dziUrl); // add `const [dziUrl, setDziUrl] = useState<string | null>(project dzi)` to state and pass into DeepZoomMap in Task 13
}
```
Add `const [dziUrl, setDziUrl] = useState<string | null>(null);` to the component state (used by `DeepZoomMap` in Task 13).

- [ ] **Step 3: Delete cleanup for Blob objects**

In `src/app/api/projects/[id]/route.ts`, update `DELETE` to also remove the project's Blob prefix:
```ts
import { list, del } from "@vercel/blob";
// ...
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const existing = await getProject(id);
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
  const { blobs } = await list({ prefix: `projects/${id}/` });
  if (blobs.length) await del(blobs.map((b) => b.url));
  await deleteProject(id);
  return NextResponse.json({ ok: true });
}
```
(Add `getProject` to the existing import from `@/lib/db`.)

- [ ] **Step 4: Verify tiling**

Run `npm run dev`, upload a map. After "Preparing deep zoom…", check:
- Response of the tile POST contains a `dziUrl` ending in `projects/<id>/dz.dzi`.
- Blob store shows `projects/<id>/dz.dzi` and `projects/<id>/dz_files/<levels>/…webp`.
- Open the `dz.dzi` URL in a browser → XML descriptor loads.
- Delete the project from `/admin` → its Blob objects disappear from the store.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/projects/[id]/tile/route.ts src/components/PlotEditor.tsx src/app/api/projects/[id]/route.ts
git commit -m "v3-engine: sharp DZI tiling to Blob + trigger on upload + delete cleanup"
```

---

### Task 13: `DeepZoomMap` component (OSD + SVG overlay)

**Files:**
- Create: `src/components/DeepZoomMap.tsx`
- Modify: `src/components/PlotEditor.tsx` (use `DeepZoomMap` when `dziUrl` is set; keep `PlotMap` fallback while tiling)
- Delete: `src/components/PlotMap.tsx` is **kept** as the fallback for the brief pre-tile window; no deletion.

**Interfaces:**
- Consumes: `openseadragon`, `openseadragon-svg-overlay` (augmented in Task 1), `toViewport`/`fromImagePixels` from `coords.ts`, `STATUS`/`STATUS_ORDER`, `Plot`/`Status`.
- Produces: `DeepZoomMap` with props:
  ```ts
  interface DeepZoomMapProps {
    dziUrl: string;
    natW: number;
    natH: number;
    plots: Plot[];              // normalized 0..1
    // admin:
    onSetStatus?: (id: number, status: Status) => void;
    onDeletePlot?: (id: number) => void;
    addMode?: boolean;
    onAddPlot?: (polygonNormalized: Pt[]) => void;
    // public:
    selectedId?: number | null;
    onSelect?: (id: number) => void;
  }
  ```

- [ ] **Step 1: Implement `DeepZoomMap.tsx`**

```tsx
"use client";

import { useEffect, useRef } from "react";
import OpenSeadragon from "openseadragon";
import "openseadragon-svg-overlay";
import { STATUS, type Plot, type Status } from "@/lib/plot";
import type { Pt } from "@/lib/detect";
import { toViewport, fromImagePixels } from "@/lib/coords";

const SVGNS = "http://www.w3.org/2000/svg";

interface DeepZoomMapProps {
  dziUrl: string;
  natW: number;
  natH: number;
  plots: Plot[];
  onSetStatus?: (id: number, status: Status) => void;
  onDeletePlot?: (id: number) => void;
  addMode?: boolean;
  onAddPlot?: (polygonNormalized: Pt[]) => void;
  selectedId?: number | null;
  onSelect?: (id: number) => void;
}

export default function DeepZoomMap(props: DeepZoomMapProps) {
  const { dziUrl, natW, natH, plots } = props;
  const hostRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<OpenSeadragon.Viewer | null>(null);
  const overlayNodeRef = useRef<SVGGElement | null>(null);
  // keep latest props for imperative OSD handlers
  const propsRef = useRef(props);
  propsRef.current = props;

  // Init viewer once per dziUrl.
  useEffect(() => {
    if (!hostRef.current || !dziUrl) return;
    const viewer = OpenSeadragon({
      element: hostRef.current,
      tileSources: dziUrl,
      showNavigationControl: true,
      navigatorPosition: "BOTTOM_RIGHT",
      gestureSettingsTouch: { pinchToZoom: true, flickEnabled: true },
      maxZoomPixelRatio: 4,
      visibilityRatio: 1,
      constrainDuringPan: true,
    });
    viewerRef.current = viewer;

    viewer.addHandler("open", () => {
      overlayNodeRef.current = viewer.svgOverlay().node();
      drawPlots();
    });

    // Admin add-mode: click to place a small box at the pointer (drag-box optional later).
    viewer.addHandler("canvas-click", (e: OpenSeadragon.CanvasClickEvent) => {
      const cur = propsRef.current;
      if (!cur.addMode || !cur.onAddPlot) return;
      e.preventDefaultAction = true;
      const vpt = viewer.viewport.pointerFromPixel(e.position);
      const img = viewer.viewport.viewportToImageCoordinates(vpt);
      // default box ~4% of width
      const half = (natW * 0.02);
      const corners: Pt[] = [
        { x: img.x - half, y: img.y - half },
        { x: img.x + half, y: img.y - half },
        { x: img.x + half, y: img.y + half },
        { x: img.x - half, y: img.y + half },
      ];
      cur.onAddPlot(corners.map((p) => fromImagePixels(p, natW, natH)));
    });

    return () => {
      viewer.destroy();
      viewerRef.current = null;
      overlayNodeRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dziUrl, natW, natH]);

  // Redraw overlay whenever plots / selection change.
  useEffect(() => {
    drawPlots();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plots, props.selectedId, props.addMode]);

  function drawPlots() {
    const node = overlayNodeRef.current;
    if (!node) return;
    while (node.firstChild) node.removeChild(node.firstChild);
    const cur = propsRef.current;
    const activeId = cur.selectedId ?? null;

    for (const plot of cur.plots) {
      const poly = document.createElementNS(SVGNS, "polygon");
      const pts = plot.polygon
        .map((p) => toViewport(p, natW, natH))
        .map((p) => `${p.x},${p.y}`)
        .join(" ");
      const color = STATUS[plot.status].color;
      const selected = plot.id === activeId;
      poly.setAttribute("points", pts);
      poly.setAttribute("fill", color);
      poly.setAttribute("fill-opacity", selected ? "0.5" : "0.22");
      poly.setAttribute("stroke", color);
      poly.setAttribute("stroke-width", "0.002"); // in viewport units
      poly.setAttribute("vector-effect", "non-scaling-stroke");
      poly.style.cursor = "pointer";
      poly.addEventListener("click", (ev) => {
        ev.stopPropagation();
        const c = propsRef.current;
        if (c.addMode) return;
        if (c.onSetStatus) {
          // admin: cycle handled by parent popup — emit select via onSelect if provided,
          // else advance status through a simple prompt-free popup handled in the editor.
          c.onSelect?.(plot.id);
          openAdminPopup(plot);
        } else {
          c.onSelect?.(plot.id);
        }
      });
      node.appendChild(poly);
    }
  }

  // Minimal admin popup: render status swatches + delete as foreignObject near the plot.
  function openAdminPopup(plot: Plot) {
    const node = overlayNodeRef.current;
    const cur = propsRef.current;
    if (!node || !cur.onSetStatus) return;
    const existing = node.querySelector("#admin-popup");
    if (existing) existing.remove();

    const c = toViewport(plot.centroid, natW, natH);
    const fo = document.createElementNS(SVGNS, "foreignObject");
    fo.setAttribute("id", "admin-popup");
    fo.setAttribute("x", String(c.x));
    fo.setAttribute("y", String(c.y));
    fo.setAttribute("width", "0.0001"); // sized by content via overflow
    fo.setAttribute("height", "0.0001");
    fo.setAttribute("overflow", "visible");
    const div = document.createElement("div");
    div.style.transform = "translate(-50%, -50%) scale(0.0016)"; // scale into viewport units
    div.style.transformOrigin = "top left";
    div.className = "flex items-center gap-1 rounded-lg border border-neutral-200 bg-white p-1 shadow-lg";
    (["available", "reserved", "booked", "sold"] as Status[]).forEach((s) => {
      const b = document.createElement("button");
      b.className = "h-6 w-6 rounded";
      b.style.backgroundColor = STATUS[s].color;
      b.onclick = () => { cur.onSetStatus?.(plot.id, s); fo.remove(); };
      div.appendChild(b);
    });
    const delBtn = document.createElement("button");
    delBtn.textContent = "🗑";
    delBtn.className = "ml-1 rounded bg-red-50 px-2 text-red-600";
    delBtn.onclick = () => { cur.onDeletePlot?.(plot.id); fo.remove(); };
    div.appendChild(delBtn);
    fo.appendChild(div);
    node.appendChild(fo);
  }

  return <div ref={hostRef} className="h-[70vh] w-full rounded-lg border border-neutral-200 bg-neutral-50 lg:h-[80vh]" />;
}
```
> Verify at execution: `openseadragon-svg-overlay` exposes `viewer.svgOverlay().node()` returning an `<g>` whose coordinate system is OSD viewport units (x∈[0,1], y∈[0,natH/natW]); confirm against the plugin's README in `node_modules/openseadragon-svg-overlay`. The `foreignObject` scale factor (`0.0016`) is approximate — tune so the popup reads ~clickable at default zoom; alternatively render the popup as a React DOM element positioned via `viewer.viewport.imageToWindowCoordinates` (fallback if `foreignObject` scaling is fiddly).

- [ ] **Step 2: Use `DeepZoomMap` in the editor when tiled**

In `PlotEditor.tsx`, import it and swap the map region: when `dziUrl` is set, render `DeepZoomMap` (operating in normalized coords directly — no proc conversion); otherwise keep `PlotMap`. Because `DeepZoomMap` emits **normalized** coords from `onAddPlot`, and `PlotEditor` currently holds proc coords for `PlotMap`, gate the two modes:
```tsx
import DeepZoomMap from "@/components/DeepZoomMap";
// ...
{dziUrl ? (
  <DeepZoomMap
    dziUrl={dziUrl}
    natW={nat.w}
    natH={nat.h}
    plots={plots.map((p) => ({
      ...p,
      polygon: normPolygon(p.polygon, proc.w, proc.h),
      centroid: normCentroid(p.centroid, proc.w, proc.h),
    }))}
    onSetStatus={setStatus}
    onDeletePlot={removePlot}
    addMode={addMode}
    onAddPlot={(normPoly) => addPlot(denormPolygon(normPoly, proc.w, proc.h))}
  />
) : (
  <PlotMap
    imgUrl={imgUrl}
    procW={proc.w}
    procH={proc.h}
    plots={plots}
    onSetStatus={setStatus}
    onDeletePlot={removePlot}
    addMode={addMode}
    onAddPlot={addPlot}
    tilt={(tilt * Math.PI) / 180}
  />
)}
```
Also initialize `dziUrl` state from the loaded project: change the editor props to include `initialDziUrl: string | null` (pass `project.dziUrl` from `src/app/admin/[id]/page.tsx`) and `useState(initialDziUrl)`.

- [ ] **Step 3: Verify deep-zoom in the editor**

Run `npm run dev`, open a tiled project.
- The map renders in OpenSeadragon; scroll/pinch zooms deeply and stays crisp.
- Plot polygons align to the map and stay crisp at all zoom levels.
- Clicking a plot (admin) opens the status/delete popup; changing status recolors and persists (reload confirms).
- With "+ Add plot box", clicking adds a box; it persists.

- [ ] **Step 4: Commit**

```bash
git add src/components/DeepZoomMap.tsx src/components/PlotEditor.tsx src/app/admin/[id]/page.tsx
git commit -m "v3-engine: OpenSeadragon deep-zoom map + SVG plot overlay in the editor"
```

---

# Phase 3 — Public Viewer & Responsive Polish

Outcome: the public shareable link renders the deep-zoom map with a clean, mobile-first availability UI; the landing page lists published projects.

### Task 14: Public `/p/[slug]`, landing index, and responsive polish

**Files:**
- Create: `src/app/p/[slug]/page.tsx`
- Rewrite: `src/components/PublicViewer.tsx` (deep-zoom + availability, mobile bottom sheet)
- Delete: `src/components/PublicClient.tsx` (folded into the page)
- Rewrite: `src/app/page.tsx` (landing = published project index)
- Modify: `next.config.ts` (allow Blob image host if any `<img>` remains) — only if needed.

**Interfaces:**
- Consumes: `getProjectBySlug`, `listProjects` (server-side), `DeepZoomMap`, `STATUS`/`STATUS_ORDER`/`countByStatus`.
- Produces: public deep-zoom viewer at `/p/[slug]`; landing list of published projects at `/`.

- [ ] **Step 1: Public viewer component**

Rewrite `src/components/PublicViewer.tsx`:
```tsx
"use client";

import { useState } from "react";
import DeepZoomMap from "@/components/DeepZoomMap";
import { STATUS, STATUS_ORDER, countByStatus, type Plot } from "@/lib/plot";

interface Props {
  name: string;
  dziUrl: string;
  natW: number;
  natH: number;
  plots: Plot[]; // normalized
}

export default function PublicViewer({ name, dziUrl, natW, natH, plots }: Props) {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const counts = countByStatus(plots);
  const selected = plots.find((p) => p.id === selectedId) || null;

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
      <div className="min-w-0 flex-1">
        <DeepZoomMap
          dziUrl={dziUrl}
          natW={natW}
          natH={natH}
          plots={plots}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
      </div>

      {/* Desktop sidebar */}
      <aside className="hidden w-72 shrink-0 flex-col gap-4 text-sm lg:flex">
        <div className="rounded-lg border border-neutral-200 p-4">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="font-semibold">Availability</h2>
            <span className="text-3xl font-bold">{plots.length}</span>
          </div>
          <Legend counts={counts} />
        </div>
        <div className="rounded-lg border border-neutral-200 p-4">
          <h3 className="mb-2 font-semibold">Selected plot</h3>
          {selected ? <StatusBadge plot={selected} /> : <p className="text-neutral-500">Tap a plot on the map.</p>}
        </div>
      </aside>

      {/* Mobile: compact legend strip + bottom sheet on selection */}
      <div className="flex flex-wrap gap-3 rounded-lg border border-neutral-200 p-3 text-xs lg:hidden">
        <span className="font-semibold">{plots.length} plots</span>
        {STATUS_ORDER.map((s) => (
          <span key={s} className="flex items-center gap-1">
            <span className="inline-block h-3 w-3 rounded-sm" style={{ backgroundColor: STATUS[s].color }} />
            {counts[s]}
          </span>
        ))}
      </div>
      {selected && (
        <div className="fixed inset-x-0 bottom-0 z-20 flex items-center justify-between gap-3 border-t border-neutral-200 bg-white p-4 shadow-2xl lg:hidden">
          <div>
            <p className="text-xs text-neutral-500">Plot {selected.num || selected.id}</p>
            <StatusBadge plot={selected} />
          </div>
          <button onClick={() => setSelectedId(null)} className="rounded border border-neutral-300 px-3 py-2 text-sm">
            Close
          </button>
        </div>
      )}
    </div>
  );
}

function Legend({ counts }: { counts: Record<string, number> }) {
  return (
    <div className="flex flex-col gap-2">
      {STATUS_ORDER.map((s) => (
        <div key={s} className="flex items-center gap-2">
          <span className="inline-block h-3.5 w-3.5 rounded-sm" style={{ backgroundColor: STATUS[s].color }} />
          <span className="text-neutral-600">{STATUS[s].label}</span>
          <span className="ml-auto font-semibold tabular-nums">{counts[s]}</span>
        </div>
      ))}
    </div>
  );
}

function StatusBadge({ plot }: { plot: Plot }) {
  return (
    <span
      className="inline-block rounded px-2 py-1 text-xs font-medium text-white"
      style={{ backgroundColor: STATUS[plot.status].color }}
    >
      {STATUS[plot.status].label}
    </span>
  );
}
```

- [ ] **Step 2: Public page (server component, published only)**

`src/app/p/[slug]/page.tsx`:
```tsx
import { notFound } from "next/navigation";
import { getProjectBySlug } from "@/lib/db";
import PublicViewer from "@/components/PublicViewer";

export const dynamic = "force-dynamic";

export default async function PublicProjectPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const project = await getProjectBySlug(slug);
  if (!project || project.status !== "published" || !project.dziUrl) notFound();
  return (
    <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <h1 className="mb-4 text-xl font-bold sm:text-2xl">{project.name}</h1>
      <PublicViewer
        name={project.name}
        dziUrl={project.dziUrl}
        natW={project.natW}
        natH={project.natH}
        plots={project.plots}
      />
    </main>
  );
}
```

- [ ] **Step 3: Landing index of published projects**

Rewrite `src/app/page.tsx`:
```tsx
import Link from "next/link";
import { listProjects } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function Home() {
  const published = (await listProjects()).filter((p) => p.status === "published" && p.dziUrl);
  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <header className="mb-6 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">Plot Projects</h1>
        <Link href="/admin" className="rounded border border-neutral-300 px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-50">
          Admin
        </Link>
      </header>
      {published.length === 0 ? (
        <p className="text-neutral-600">No published projects yet.</p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {published.map((p) => (
            <li key={p.id}>
              <Link href={`/p/${p.slug}`} className="block rounded-lg border border-neutral-200 p-5 hover:border-blue-400 hover:bg-blue-50/30">
                <h2 className="font-semibold">{p.name}</h2>
                <p className="text-sm text-neutral-500">{p.plots.length} plots</p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
```

- [ ] **Step 4: Delete `PublicClient.tsx` and verify the full flow**

Run:
```bash
git rm src/components/PublicClient.tsx
npm run build
```
Expected: build succeeds.

Then `npm run dev` and verify end-to-end on a **fresh browser/incognito** (no admin cookie):
- Publish a project in `/admin`.
- Open `/` → the project appears; click → `/p/<slug>` shows the deep-zoom map + availability.
- Deep-zoom stays crisp; tapping a plot shows its status (bottom sheet on a mobile viewport).
- Resize to a phone width (or use Playwright): map fills ~70vh, legend strip shows, bottom sheet works, tap targets are comfortable.
- An unpublished project's `/p/<slug>` returns 404.

- [ ] **Step 5: Mobile verification with Playwright (optional but recommended)**

Use the Playwright MCP to load `/p/<slug>` at a 390×844 viewport, screenshot, and confirm the map + legend + bottom-sheet render without overflow. Fix any overflow/tap-target issues inline.

- [ ] **Step 6: Commit**

```bash
git add src/app/p src/components/PublicViewer.tsx src/app/page.tsx
git commit -m "v3-engine: public deep-zoom viewer /p/[slug] + published landing index + mobile UI"
```

---

## Final Verification & Cleanup

- [ ] Run the full unit suite: `npx vitest run` → all pass.
- [ ] `npm run build` → succeeds with no type errors.
- [ ] Grep for dead references: `grep -rn "idb-keyval\|konva\|tesseract\|dxf-parser\|saveProject\|loadProject\|AdminGate\|PublicClient" src` → no results (except intended). Remove any stragglers.
- [ ] Confirm `PlotMap.tsx` is still used only as the pre-tile fallback in the editor; if the fallback was dropped, `git rm` it.
- [ ] Update `README.md`: env vars (`POSTGRES_URL`, `BLOB_READ_WRITE_TOKEN`, `ADMIN_PASSWORD`, `AUTH_SECRET`), `npm run db:setup`, deploy notes (Vercel Postgres + Blob; raise `maxDuration` if tiling large maps).
- [ ] Commit: `git commit -am "v3-engine: docs + final cleanup"`.

---

## Self-Review (completed during authoring)

- **Spec coverage:** multi-project engine (Tasks 6–10), shareable links (Task 14 `/p/[slug]`), deep-zoom (Tasks 11–13), single-operator auth (Tasks 5, 7, 9), clean responsive UI (Task 14), dependency cleanup (Task 1 + Final), normalized coords (Task 3, used throughout), Blob `addRandomSuffix:false` (Tasks 11–12). All spec sections map to a task.
- **Type consistency:** `ProjectRow` shape is defined in Task 6 and consumed unchanged in Tasks 8/10/11/12/14; `Plot` normalized-coord contract is fixed in Task 2 and honored at every DB boundary; `DeepZoomMap` prop names match the editor/public call sites.
- **Deferred (roadmap, not in this plan):** 3D viewer, plot dimensions/price/facing, scale calibration, leads/WhatsApp/QR, multi-user — per spec §10.

## Known verify-at-execution points (library API confirmation)

These are concrete in the plan but should be checked against installed package types when reached (not blockers, just version-drift guards):
1. `@vercel/postgres` `sql` template usage (Task 6).
2. `@vercel/blob/client` `handleUpload`/`upload` option names (Tasks 11).
3. `sharp(...).webp().tile({layout:'dzi'})` output naming + webp tiles (Task 12).
4. `openseadragon-svg-overlay` `viewer.svgOverlay().node()` coordinate system + the admin popup `foreignObject` scaling (Task 13).
