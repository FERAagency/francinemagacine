# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

Portfolio site for illustrator Francina Pasarelli ("Francine Magacine"). Single-file static site (`index.html`) deployed on Netlify, with Supabase as the backend for persistent content.

## Repo layout

- `index.html` — the entire site (markup, CSS, JS)
- `_redirects` — Netlify rule proxying `/img/*` to the Supabase storage bucket
- `netlify/functions/upload.js` — serverless function handling image upload/delete
- `images/` — local `illus1–10.png` originals (the site serves Supabase-hosted WebP versions)
- `deploy.zip` — **legacy** build output, git-ignored; no longer a deployment route
- `.claude/rebuild-zip.py` — hook that still regenerates `deploy.zip`; a harmless leftover

## Architecture

Everything lives in `index.html` (~4330 lines). There are no build tools, no npm, no bundlers — the file is opened directly in a browser or deployed as-is to Netlify.

**Structure of `index.html`:**
1. `<head>` — Google Fonts (Nunito, Noto Sans SC), all CSS in one `<style>` block
2. `<body>` — HTML sections in order: nav, hero, portfolio grid, about, Instagram, blog, contact, footer
3. Overlay UI panels (also in `<body>`): book lightbox, blog post panel, legal panels (privacy/terms), admin login, admin bar, admin panel, project editor modal, blog editor
4. One large `<script>` block at the end containing all JavaScript

**CSS design tokens** (defined in `:root`):
- Colors: `--cream`, `--bark`, `--sage`, `--moss`, `--leaf`, `--mist`, `--stone`, `--warm`
- Radii: `--r-sm`, `--r-md`, `--r-lg`, `--r-pill`
- Breakpoints: 780px is the main mobile breakpoint (and the one the mobile background depends on). 900px and 580px handle grid and single-column reflow; several narrower one-off queries exist for individual components.

## Supabase integration

The site uses Supabase REST API directly (no SDK). Credentials are in the script block:
- `SUPABASE_URL` — the project URL
- `SUPABASE_KEY` — the publishable anon key (safe to be in client code)

The privileged service key is **not** in client code — it lives in Netlify environment variables (`SUPABASE_SERVICE_KEY`) and is only used by `netlify/functions/upload.js`.

**Row Level Security is on for `site_data`.** `anon` may **read only**; `authenticated` may read and write. Policies: `"Public can read"` (select, to anon + authenticated) and `"Admin can write all"` (for all, to authenticated).

This means every admin save must carry the logged-in JWT — `dbSet()` does, `dbGet()` reads with the anon key. Writing with the anon key returns `403` / `42501 new row violates row-level security policy`. If admin saving ever breaks with that code, check `pg_policies` before changing any JS:

```sql
select policyname, cmd, roles, qual, with_check
from pg_policies where schemaname='public' and tablename='site_data';
```

Note when probing RLS from outside: a blocked DELETE or UPDATE returns `204`/`200` with **zero rows affected**, not an error — only INSERT reports `42501`. Use `Prefer: return=representation` and check for an empty array.

**Two Supabase tables:**
- `site_data` — key/value store. Rows have `key` (string) and `value` (JSON string). Keys used: `admin_data` (hero text, about text/photo, project data, Instagram config) and `blog_posts` (array of post objects).
- `images` — Supabase Storage bucket for uploaded images (illustrations, profile photo, blog covers, Instagram previews).

**Helper functions:**
- `dbGet(key)` — fetches a row from `site_data` and parses the JSON value
- `dbSet(key, value)` — upserts a row using `Prefer: resolution=merge-duplicates`

## Multilingual system

Four languages: Spanish (`es`, default), English (`en`), Brazilian Portuguese (`pt`), Simplified Chinese (`zh`).

Translations are stored in a `translations` object keyed by `data-tid` attribute values. Every text element in the HTML has a `data-tid` attribute. `setLang(l)` iterates all `[data-tid]` elements and sets `innerHTML` from the translations object. Admin-edited content (hero desc, about paragraphs, project descriptions) overrides the defaults in `translations` at load time via `applyAdminData()`.

## Admin system

Accessed by typing a hidden keyword anywhere on the page (keyword is obfuscated in the script by joining string fragments). Authentication is **Supabase Auth**: `POST /auth/v1/token?grant_type=password` for the user in the `ADMIN_EMAIL` constant. The access token is held in memory, the refresh token in `localStorage['fm_admin_session']`, so the session survives a reload. The password never leaves Supabase.

The old client-side hash chain (`DEFAULT_PW_HASH`, `localStorage['fm_admin_pw_hash']`, `adminData.pwHash`) is **gone** — none of those identifiers exist any more. Reset the password from the admin panel or the Supabase dashboard, never in code.

**Admin flow:** Login modal → Admin bar (bottom strip) → Admin panel (fullscreen editor) → Project editor modal (for individual projects).

Content editable in the admin panel:
- Hero description (all 4 languages)
- About paragraphs (all 4 languages) + profile photo
- Per-project: title, tag, description (all 4 languages), illustration images, coming-soon toggle, hide-from-site toggle
- Adding and deleting whole projects
- Instagram handle + preview images (up to 8)
- Blog posts (title, tag, date, cover, excerpt, body, draft toggle)
- Admin password change

After saving, `applyAdminData()` patches the live `projects` array and `translations` object, then calls `renderGrid()` and `setLang()` to refresh the page without a reload.

**Gotchas that have broken this panel before** — open/close uses inline `style.transform`, the panel's z-index must stay below the admin bar's, and every `window.X = X;` binding must reference a function that actually exists or the rest of `DOMContentLoaded` silently aborts. See the project memory `feedback-admin-panel` for the full list.

## Image handling

Uploads go through the Netlify function, not straight to Supabase:

```
POST /api/upload      headers: x-filename, Content-Type    body: raw file bytes
DELETE /api/upload?file=<filename>
```

The function (routed by its own `export const config = { path: '/api/upload' }`) forwards to Supabase Storage using the service key from `process.env`, with `x-upsert: true`.

Images are then referenced by a **same-origin** path, never a direct Supabase URL:

```
/img/${filename}
```

`_redirects` proxies `/img/*` to `${SUPABASE_URL}/storage/v1/object/public/images/:splat`. Using the same-origin path matters — serving backgrounds from the cross-origin Supabase URL is what caused the long-standing mobile background failure.

Assets served this way: backgrounds (`bg2.webp` desktop, `bgmobile.webp` under 780px), logos (`fmlogo.webp`, `logo1.webp`, `instalogo.webp`), and lightbox illustrations (`illus8–11.webp`).

## Book lightbox

Clicking an illustration opens a two-page-spread "book" viewer (`#book-flipper`, with `#bv-l`/`#bv-r`/`#bv-spine`/`#bv-turn`/`#bv-shadow` as the page elements). Image 0 is the cover, shown full-width as a closed book; images 1+ each fill the whole spread via `background-size: 200% 100%`. Mobile is single-page.

Controls: arrow buttons, drag, tap left/right half, swipe, keyboard arrows, Escape. All wired with JS listeners, **not** `onclick`.

Key functions: `openBookLightbox(startIdx)`, `bookLbFlip(dir)`, `_blComputeSize`, `_blPreloadSizes`, `_blSizeFor`, `_blApplySize`, `_blSetPage`, `_blDraw`.

The frame resizes to each image's real aspect ratio (sizes are preloaded into a cache on open), so illustrations of different shapes are neither cropped nor stretched. This is deliberate — the book visibly changes shape between tall and wide illustrations rather than letterboxing them.

## Legal panels

Privacy Policy and Terms are two slide-up overlays (`#privacy-panel`, `#terms-panel`, class `.legal-panel`), opened from links in the footer. They reuse the `.blog-post-panel` pattern — fixed inset, `transform: translateY(100%)`, `.open` slides them in — at `z-index: 260`.

The copy itself lives in a `legalContent` object (`{ privacy: {es,en,pt,zh}, terms: {es,en,pt,zh} }`) as HTML strings in template literals, **not** in the `translations` object — the documents are too long for the `data-tid` mechanism. Because it is a `const` read by `setLang`, it must stay declared above the `setLang('es')` call or it dies in the temporal dead zone.

Key functions: `openLegal(kind)` where kind is `'privacy'` or `'terms'`, `closeLegal()`, and `renderLegal()`, which `setLang()` calls so an open panel follows the language switcher. Escape also closes.

**The legal text asserts Argentine jurisdiction** (Ley 25.326, Ley 11.723, courts of CABA). This was inferred, never confirmed — verify before extending it. Nothing in these documents is lawyer-reviewed.

## Projects data

The `projects` array in the script ships six starting slots, but **the list grows and shrinks from the admin panel** — "+ Agregar proyecto" appends, per-card "Eliminar" removes.

All six original slots hold **real projects** with images. The hardcoded `Próximamente` entries for slots 5 and 6 are only fallbacks that saved data fully overrides — do not treat them as placeholders.

Each project has: `title` (HTML string), `titleText` (plain text), `titleEn`, `titlePt`, `tag`, `desc` (Spanish), `descEn`, `descPt`, `descZh`, `images` (array of URLs), `count`, `comingSoon`, `hidden`.

**Three visibility states:**
- normal — clickable card
- `comingSoon: true` — dimmed "Próximamente" teaser card
- `hidden: true` — **no element rendered at all**; `renderGrid()` early-returns

`hidden` is the activation gate. `blankProject()` sets it `true`, so a newly added slot never appears as a blank card on the live site before it has been filled in.

**Critical:** `applyAdminData()` treats `adminData.projects` as **authoritative for length**, truncating or growing the live array to match. Without that, an added slot saves and then vanishes on reload. Preserve this or add/delete silently stops persisting.

`projectsForSave()` is the single serializer, used by `saveProject`, `addProject`, and `deleteProject`, so no slot loses its images when another is saved.

Deleting a project does **not** remove its images from storage — deliberate; orphaned files accumulate.

## Deployment

No build step and no zip upload. The site is **repo-connected**: Netlify builds from `FERAagency/francinemagacine` on every push to `main`, publishing in roughly 15–30 seconds. **Deploying is `git push`.**

`netlify/functions/upload.js` deploys from git along with everything else.

**Required Netlify environment variables** — Project configuration → Environment variables. Without them `/api/upload` returns `500 Server misconfigured`:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_KEY` — the Supabase `service_role` key; mark it secret, never commit it

Names are case-sensitive and must match `process.env` exactly. **Env var changes only reach the function after a fresh deploy** — setting them alone does nothing, which is the single most time-wasting trap here. The config page's "Last update at H:MM" line is the tell: if it predates the variables, the running function has not seen them.

Health probe, no auth required:

```
curl -s -w "\n%{http_code}\n" -X POST https://francinemagacine.netlify.app/api/upload
```

- `401 Unauthorized` — healthy; the function reached its auth gate
- `500 Server misconfigured` — a variable is missing, or the build predates it
- `404` — the function stopped deploying

Sending a bogus bearer token and still getting `401` (rather than `500`) additionally proves `SUPABASE_URL` is reachable and the service key authenticates.

Netlify UI notes: "All scopes" is the free option — "Specific scopes" is the paid one. If the variable form is stuck on "Different value for each deploy context", filling **Production** alone is enough for the live site; leave **Local development (Netlify CLI)** empty for secrets, since Netlify states that field is not treated as secret. `Site is live` is the **final** line of a successful deploy log, not a hang.

`deploy.zip` is legacy build output, git-ignored, and no longer a deployment route. A `PostToolUse` hook (`.claude/settings.local.json` → `.claude/rebuild-zip.py`) still regenerates it after `Edit`/`Write` edits to `index.html`; that is harmless. **Never treat a stale zip as a deployment problem, and never tell the user to upload one.**
