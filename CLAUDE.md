# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

Portfolio site for illustrator Francina Pasarelli ("Francine Magacine"). Single-file static site (`index.html`) deployed on Netlify, with Supabase as the backend for persistent content.

## Repo layout

- `index.html` — the entire site (markup, CSS, JS)
- `_redirects` — Netlify rule proxying `/img/*` to the Supabase storage bucket
- `netlify/functions/upload.js` — serverless function handling image upload/delete
- `deploy.zip` — what gets uploaded to Netlify; contains `index.html` + `_redirects` only
- `images/` — local `illus1–10.png` originals (the site serves Supabase-hosted WebP versions)
- `.claude/rebuild-zip.py` — hook script that regenerates `deploy.zip`

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

The privileged service key is **not** in client code — it lives in Netlify environment variables and is only used by `netlify/functions/upload.js`.

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

Accessed by typing a hidden keyword anywhere on the page (keyword is obfuscated in the script by joining string fragments). Password is hashed with SHA-256 via `crypto.subtle.digest` and stored only in `localStorage` — never sent to the server.

**Admin flow:** Login modal → Admin bar (bottom strip) → Admin panel (fullscreen editor) → Project editor modal (for individual projects).

Content editable in the admin panel:
- Hero description (all 4 languages)
- About paragraphs (all 4 languages) + profile photo
- Per-project: title, tag, description (all 4 languages), illustration images, coming-soon toggle
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

Six project slots are hardcoded in the `projects` array in the script. Each has: `title` (HTML string), `titleText` (plain text), `tag`, `desc` (Spanish), `descEn`, `descPt`, `descZh`, `images` (array of URLs), `comingSoon`. The admin panel can override all fields; slots 5 and 6 start as "coming soon" (`Próximamente`).

## Deployment

No build step. Deployment is a `deploy.zip` upload in the Netlify UI.

`deploy.zip` is rebuilt automatically by a `PostToolUse` hook (`.claude/settings.local.json` → `.claude/rebuild-zip.py`) after every edit to `index.html`. **The hook only loads when the session starts from inside this directory** — if launched from a parent dir, the zip goes stale silently. Rebuild manually with:

```
printf '{"tool_input":{"file_path":"/home/emi/Projects/Francine/index.html"}}' | python3 .claude/rebuild-zip.py
```

Note that the zip contains only `index.html` and `_redirects` — it does **not** include `netlify/functions/upload.js`. The function has to reach Netlify by some other route for admin image uploads to work in production.
