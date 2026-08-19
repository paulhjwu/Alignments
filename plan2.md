# Deployment Plan: Static Alignments Site on Hostinger VPS (own compose stack, fronted by the existing container)

## What this actually is

Two self-contained, client-side HTML pages (HTML/CSS/JS inline, no build step), no backend:

- **`bible-alignment-viewer.html`** — on load, fetches hardcoded lists of alignment JSON/TSV files under `data/<lang>/alignments/<version>/*.json` (plus `data/sources/*.tsv`, `data/<lang>/targets/**/*.tsv`), parses them client-side, and renders aligned source/target words. Clicking a Strong's number opens an in-page modal that fetches `lexicon/<greek|hebrew>/<G|H><num>.md` and renders it.
- **`lexicon-browser.html`** — standalone lexicon reader, fetches the same `lexicon/<greek|hebrew>/<G|H><num>.md` files directly.

All `fetch()` calls in both pages use **paths relative to the page**, not root-absolute (`data/...`, `lexicon/...`), so both pages work unmodified from any URL prefix. There is no third HTML entry point today, so this plan adds one small static `index.html` linking the two.

The `bible_alignments` Python package (`bible_alignments/`) is an offline authoring/validation tool, not used by either page at runtime — it does not need to be deployed.

Same as [plan.md](plan.md)'s conclusion for the treebank site: **serve static files over HTTPS, no app server, no database, no build step.**

## Data footprint (informs the approach below)

```
data/     834M    95 files, git-tracked (largest is 50MB — under GitHub's 100MB limit, no LFS needed)
lexicon/   56M    14,198 files, git-ignored (see .gitignore:32 — never committed)
*.html     72K    bible-alignment-viewer.html, lexicon-browser.html
```

~890MB total. Too large to bake into a Docker image, small enough for `rsync`. **Serve from a bind-mounted directory, not from inside a built image.**

One wrinkle this repo has that the treebank repo didn't: **`lexicon/` is `.gitignore`d** (`.gitignore:32`). A plain `git clone` on the VPS will *not* bring it over — it has to be `rsync`'d separately regardless of which path gets the rest of the repo onto the VPS. `data/raw` is also ignored but isn't read by either page, so it can be skipped.

## Architecture: independent stack, shared front door

This repo gets its **own `docker-compose.vps.yml`** (named to match the existing deployment's convention — see `ansible/update.yml`, which already expects that filename), deployable and updatable on its own — `docker compose -f docker-compose.vps.yml up -d` in this repo's directory doesn't touch, restart, or depend on the treebank deployment at all. It still ends up served through the **same public container** on 80/443 (one TLS cert, one set of open ports, no DNS or firewall changes), by joining the existing shared Docker network — **`workshop_default`**, the network the front-end stack's own `docker compose` already created (its compose project is named `workshop`) — and being reached **by container name** rather than by a host port:

```
Internet ──443──▶ [existing front-end caddy container, project "workshop"]
                        │  handle_path /treebank/*  → (its own existing volume, unchanged)
                        │  handle_path /alignments/* → reverse_proxy alignment:80
                        ▼
                   [this repo's own caddy container]   (own docker-compose.vps.yml, own volume, no host ports)
                        serves index.html, bible-alignment-viewer.html, lexicon-browser.html, data/, lexicon/
                        joins the existing "workshop_default" network
```

Why this instead of bind-mounting this repo's data into the existing container (the alternative considered): the existing compose file and Caddyfile only need **one small, generic addition** (a route + a network join) that never needs to change again as this repo's data grows or its own config evolves — all of that lives here, in this repo's own compose file, versioned alongside the code.

Two lessons carried over from the treebank deploy's failed-attempt notes still apply: keep each Caddy config **inline** in its `docker-compose.yml` (never a bind-mounted `./Caddyfile` — Docker silently mkdirs a directory over a missing file and the container won't start), and use **named matchers** for anything path-scoped (bare globs on `header`/`root` fail quietly instead of erroring).

## Files in this repo

1. **`index.html`** (repo root) — landing page for `/alignments/`, since there are two entry points here (unlike treebank's one):
   ```html
   <!DOCTYPE html>
   <html><head><meta charset="utf-8"><title>Bible Alignments</title></head>
   <body>
     <h1>Bible Alignments</h1>
     <ul>
       <li><a href="bible-alignment-viewer.html">Alignment Viewer</a></li>
       <li><a href="lexicon-browser.html">Lexicon Browser</a></li>
     </ul>
   </body></html>
   ```

2. **[`docker-compose.vps.yml`](docker-compose.vps.yml)** — a single `caddy` service, no `ports:` published to the host (it's only reachable from the shared internal network, not directly from the internet). `ansible/update.yml` already assumes this exact filename and passes `EDGE_NETWORK` as an environment variable on `docker compose up`, so the network name is templated rather than hardcoded:
   ```yaml
   name: alignment   # pinned — a checkout at /opt/alignments would otherwise
                      # derive project name "alignments", not "alignment"

   services:
     caddy:
       image: caddy:2
       container_name: alignment
       restart: unless-stopped
       networks:
         - edge
       configs:
         - source: caddyfile
           target: /etc/caddy/Caddyfile
       volumes:
         - .:/srv:ro

   networks:
     edge:
       external: true
       name: ${EDGE_NETWORK:?set EDGE_NETWORK to the front Caddy container's network}

   configs:
     caddyfile:
       content: |
         :80 {
             root * /srv
             encode zstd gzip
             file_server
             @cacheable path *.json *.tsv *.md
             header @cacheable Cache-Control "public, max-age=86400"
             header /index.html Cache-Control "no-cache"
             header /bible-alignment-viewer.html Cache-Control "no-cache"
             header /lexicon-browser.html Cache-Control "no-cache"
         }
   ```
   The service listens on plain `:80` inside the Docker network — TLS is still terminated once, at the existing front-end container. Cache headers target this site's actual fetched types (`*.json`/`*.tsv`/`*.md`), unlike treebank's `*.xml`, using the same named-matcher pattern the treebank plan already validated (bare globs on `header` fail silently). No `rewrite`/`redir` to a single entry file is needed here (unlike treebank's `rewrite / /bereshit-treebank.html`) — `file_server` already serves `index.html` for `/`, and that page links to both HTML apps.

   Explicit `container_name`/`name` matter here: with two independent compose projects both able to derive a service or project name that collides on the shared network's DNS or in `docker compose` output, pinning both to `alignment` keeps this container's identity stable regardless of what directory it's checked out into, and matches what the front Caddy's `reverse_proxy` target expects.

3. **`.dockerignore`** — not strictly needed (no image build here either), but worth adding so a stray `docker build .` doesn't slurp 890MB: `.git`, `.venv`, `research`, `*.md`.

## One-time setup on the existing (treebank) deployment

This is the only touch point between the two stacks, and it's small and generic — it doesn't need to change again as this repo evolves. No new network needs to be created: `workshop_default` already exists (it's that compose project's own default network), so this is purely additive.

1. **Attach the existing `caddy` service to it** — add to its `docker-compose.yml`, if not already present:
   ```yaml
   services:
     caddy:
       networks:
         - default   # already on workshop_default implicitly if this is the "workshop" project
   ```
   (If the front-end container's compose project is literally named `workshop`, its service is already on `workshop_default` by default — this step may be a no-op. Confirm with `docker network inspect workshop_default` and check whether the front-end `caddy` container is already listed.)
2. **Add one route to the existing inline Caddyfile**, alongside whatever already serves `/treebank/*`:
   ```
   handle /alignments {
       redir /alignments /alignments/
   }
   handle_path /alignments/* {
       reverse_proxy alignment:80
   }
   ```
   The bare `/alignments` → `/alignments/` redirect matters even though `handle_path` strips the prefix before proxying: without it, a browser hitting `/alignments` (no trailing slash) gets `index.html`'s content back but resolves its relative links (`bible-alignment-viewer.html`, etc.) against `/`, not `/alignments/`, and 404s. This is the same class of gotcha as the treebank plan's named-matcher lesson — easy to miss, fails quietly.
3. **Recreate that container**: `docker compose up -d --force-recreate caddy` in the existing deployment's directory — a plain `restart` won't pick up the edited inline config.

## Deployment steps (this repo, independent of the above)

1. **Push local commits to `origin/main` first.** `ansible/update.yml` only ever *pulls* from GitHub — anything still local-only (an uncommitted file, an unpushed commit) is invisible to it.
2. **Run `ansible/update.yml`** — `ansible-playbook -i srv1798889.hstgr.cloud, -u root ansible/update.yml`. This single command now covers the whole thing, first deploy or routine update alike:
   - `git pull` into `/opt/alignments` (does an implicit `git clone` if that path doesn't exist yet).
   - `rsync -az --delete lexicon/ root@<vps>:/opt/alignments/lexicon/`, delegated to your local machine (since `lexicon/` is gitignored, `git pull` never sees it — this task syncs whatever `lexicon/` you have checked out *locally*, not whatever's already on the VPS, so run it from a checkout that actually has `lexicon/` populated).
   - `docker compose -f docker-compose.vps.yml up -d` — idempotent: creates the container on a first deploy, recreates it if `docker-compose.vps.yml`/its inline Caddyfile changed since the container was last started (Compose diffs the config itself), no-ops otherwise.

   *Alternative for a first deploy without Ansible*: seed the host directly with a single `rsync` of the whole tree (brings both the tracked files and `lexicon/` in one pass, no git/SSH-key setup required on the VPS), then `cd /opt/alignments && docker compose -f docker-compose.vps.yml up -d` by hand:
   ```
   rsync -avz --progress ./ root@<vps>:/opt/alignments/ \
     --exclude '.venv' --exclude '.git' --exclude 'research' --exclude '*.pyc'
   ```
3. **Verify from inside the VPS first** (before wiring up the proxy, to isolate failures):
   ```
   docker exec alignment wget -qO- http://localhost/index.html | head -5
   ```
4. **Do the one-time front-end setup above** (network check + route + recreate the existing container) — this step is manual and not run by `ansible/update.yml`, which never touches the treebank deployment — then verify end-to-end:
   - `curl -I https://yourdomain.com/alignments/` → 200 (serves `index.html`).
   - `curl -I https://yourdomain.com/alignments/bible-alignment-viewer.html` and `.../lexicon-browser.html` → 200.
   - `curl -I https://yourdomain.com/alignments/data/eng/alignments/BSB/SBLGNT-BSB-manual.json` and `.../alignments/lexicon/greek/G26.md` → 200, confirms both the tracked `data/` and the rsync'd `lexicon/` landed correctly.
   - Confirm `https://yourdomain.com/treebank/...` **still works** — this change should be additive; a regression there means the existing Caddyfile edit broke its own route.
   - Open `/alignments/bible-alignment-viewer.html` in a browser: pick an alignment/source/target triple, load it, click a Strong's number, confirm the lexicon modal renders. Open `/alignments/lexicon-browser.html` separately and confirm direct lexicon lookups work too.
   - `docker compose -f docker-compose.vps.yml logs -f caddy` (this stack) and `docker compose logs -f caddy` (the front-end) for errors.

## Ongoing maintenance

- **Updates**: same command as the initial deploy — `ansible-playbook -i srv1798889.hstgr.cloud, -u root ansible/update.yml` — after pushing to `origin/main` first. `docker compose up -d` being idempotent means the playbook doesn't need to figure out whether anything changed: it recreates the container automatically when `docker-compose.vps.yml`/its inline Caddyfile did, and no-ops when they didn't, since Caddy reads the bind-mounted `data`/`lexicon` live either way. Run it from a checkout that actually has `lexicon/` populated locally — that `rsync` task is delegated to your local machine, not the VPS. **The treebank deployment is untouched by any of this.**
- **Logs/monitoring**: `docker compose logs` in each stack's own directory; the front-end container's logs cover both `/treebank` and `/alignments` request routing, but each backend's own logs are separate.
- **Backups**: stateless — the repo (tracked `data/` + untracked-but-rsync'd `lexicon/`) plus the HTML files are the only state. No named volumes at all in this stack (unlike a TLS-terminating Caddy, there's no ACME cert cache to preserve, since TLS is terminated upstream).
- **Rollback**: keep the previous `/opt/alignments/` copy, or re-`rsync` from a previous commit/tag plus the corresponding lexicon snapshot — no image tag to pin since nothing is built. Rolling back this stack never risks the treebank site.
- **Decommissioning**: to remove this site entirely, `docker compose -f docker-compose.vps.yml down` here, then delete the `handle /alignments` / `handle_path /alignments/*` blocks from the front-end Caddyfile and recreate it — no cleanup needed inside the front-end container's own volumes.
