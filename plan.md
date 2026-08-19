# Deployment Plan: Static Treebank Site on Hostinger VPS

## What this actually is

`bereshit-treebank.html` is a single self-contained, client-side page (HTML/CSS/JS inline, no build step). It has no backend: on load, its JS `fetch()`es small XML files at runtime — one per chapter under `WLC/nodes/<book>-<chapter>.xml` for the Hebrew (WLC) corpus, one per whole book under `SBLGNT/nodes/<book>.xml` for the Greek (SBLGNT) corpus — parses them client-side, and draws the tree in the browser.

That means the entire deployment is: **serve three things as static files over HTTPS** — `bereshit-treebank.html`, `WLC/`, and `SBLGNT/`. No app server, no Python, no database, no build/compile step. `fetch()` of `file://` URLs is blocked by browsers, so it does need to be served over real HTTP(S) — it can't just be double-clicked — but that's the only real constraint.

This repo is currently **not a git repo and has none of the deployment files below yet** — this document is a plan to create them, not a record of what's done.

## Data footprint (informs the approach below)

```
WLC/nodes/     724M   930 chapter XML files
SBLGNT/nodes/  101M    27 whole-book XML files
bereshit-treebank.html  52K
```

~825MB total, no single file over a few MB. That's small enough for plain `git`/`rsync` (no Git LFS needed) but large enough that baking it into a Docker image would be wasteful — a fresh image build/push/pull on every deploy for data that rarely changes. So: **serve the files from a bind-mounted directory, not from inside a built image.** That also means no `Dockerfile` and no image-build step at all — just the official `caddy` image plus a volume mount.

## How Hostinger fits in

Same platform as before: **Hostinger VPS with Docker Manager** — a regular Ubuntu VPS with Docker + Compose preinstalled, deployable via SSH or Docker Manager's "Compose from URL". Caddy still does the job of automatic HTTPS (Let's Encrypt) and reverse-proxy/static-serving — it's just the *only* container now, since there's no app to proxy to.

Sources:
- [Docker VPS hosting](https://www.hostinger.com/docker-hosting)
- [How to deploy your first container with Hostinger Docker Manager](https://www.hostinger.com/support/12040815-how-to-deploy-your-first-container-with-hostinger-docker-manager/)
- [Hostinger Docker manager for VPS](https://www.hostinger.com/support/12040789-hostinger-docker-manager-for-vps-simplify-your-container-deployments/)

If you already have a Hostinger VPS running other projects (the old `plan.md`/`README.md` here referenced one at `srv1798889.hstgr.cloud`), the cheapest path is to **add this as a second Caddy site block on that same VPS** rather than provisioning a new one — see the note in step 2 below. Everything else in this plan works either way.

## Files to create

None of these exist yet. All four are small and go in the repo root.

1. **`docker-compose.yml`** — a single `caddy` service:
   ```yaml
   services:
     caddy:
       image: caddy:2
       restart: unless-stopped
       ports:
         - "80:80"
         - "443:443"
       configs:
         - source: caddyfile
           target: /etc/caddy/Caddyfile
       volumes:
         - .:/srv:ro
         - caddy_data:/data
         - caddy_config:/config
   volumes:
     caddy_data:
     caddy_config:
   ```
   No `build:`, no `Dockerfile` — the official image plus the bind mount is the whole app.
2. **Caddy config**, inline in `docker-compose.yml` under `configs:`:
   ```
   ${SITE_DOMAIN:-yourdomain.com} {
       root * /srv
       encode zstd gzip
       redir / /bereshit-treebank.html
       file_server
       @xml path *.xml
       header @xml Cache-Control "public, max-age=86400"
       header /bereshit-treebank.html Cache-Control "no-cache"
   }
   ```
   `redir /` sends the bare domain straight to the app without renaming the source file. `encode` matters here more than usual — XML tree data compresses well and there are hundreds of files fetched on demand (measured: a 1.1MB chapter goes out as ~102KB gzipped). **Set the real domain via `SITE_DOMAIN` before deploying.**

   Two things here are deliberate, both learned from a failed deploy:
   - The config is **inline**, not a bind-mounted `./Caddyfile`. Hosted deployers resolve relative paths against their own project directory, and Docker auto-creates a *directory* at a missing bind-mount source — which then can't mount over the image's `/etc/caddy/Caddyfile`, and the container fails to start.
   - The XML rule uses a **named matcher** (`@xml path *.xml`). Written as `header /*.xml …` it only matches XML at the root, never `/WLC/nodes/*.xml`; written as `header *.xml …` it parses as the three-argument header-*replacement* form and silently does nothing. Both variants fail quietly, serving 825MB of XML with no cache headers at all.
3. **`.dockerignore`** — not strictly needed (no image build), but worth adding anyway so a stray `docker build .` doesn't slurp 825MB: `.git`, `*.md`, editor cruft.
4. **`.gitignore`** — this repo isn't a git repo yet; before pushing/cloning, at minimum ignore OS/editor cruft (`.DS_Store`, `*.swp`).

## What's left — manual steps in your Hostinger account

1. **Domain**: register through Hostinger or use one you own, *or* reuse an existing VPS's domain/subdomain if adding this alongside another project. Set it as the `SITE_DOMAIN` environment variable for the deployment.
2. **VPS**: provision (or reuse) a Hostinger VPS with the Docker/Ubuntu 24.04 template. This is pure static file serving with no meaningful CPU/RAM/DB load, so the entry-level **KVM 1** plan (1 vCPU / 4GB RAM) is comfortably enough — there's headroom to add other projects to the same box.
3. **DNS**: A record for the domain → the VPS's public IP (skip if reusing an existing VPS/domain and just adding a site block).
4. **Get the ~825MB of data onto the VPS** — see the deploy step below; given the size, `rsync`/`scp` over SSH is likely more practical than routing it through GitHub, though either works.

## Deployment steps

1. **Get the repo onto the VPS**, either:
   - *SSH + rsync* (recommended given the data size): `rsync -avz --progress ./ root@<vps>:/opt/parse-tree/`, or `git clone` if you'd rather push this to GitHub first (fine at this size — no file exceeds GitHub's 100MB limit, just expect the initial push/clone to take a bit).
   - *Docker Manager "Compose from URL"*: only convenient if the repo (including the 825MB of XML) is already on GitHub.
2. **Start it**: `cd /opt/parse-tree && docker compose up -d` (no `--build` needed — nothing to build).
3. **Verify**:
   - `curl -I https://yourdomain.com/` → redirects to `/bereshit-treebank.html`, 200.
   - `curl -I https://yourdomain.com/WLC/nodes/01-Gen-001.xml` and `.../SBLGNT/nodes/04-john.xml` → 200, sane `Content-Type`.
   - Open the page in a browser, confirm both the Hebrew (WLC) and Greek (SBLGNT) corpus selectors load a chapter and render a tree.
   - `docker compose logs -f caddy` for errors; confirm the cert was issued (browser padlock).
4. **Firewall**: only 80/443 (and 22 for SSH) need to be open — there's no app port to accidentally expose (no port 5000 here, unlike a backend app).

## Visitor analytics (optional, self-hosted Umami)

Same approach as before if you want it: add `db` (Postgres) + `umami` services to `docker-compose.yml`, plus a second Caddy site block on a dedicated port (e.g. `:8443`) proxying to `umami:3000`, since Umami's subpath support requires a custom image build. `.env`/`.env.example` for `POSTGRES_PASSWORD`/`APP_SECRET`, gitignored.

Manual steps if you go this route: open port 8443 in the VPS firewall, then after deploy — log in, change the default `admin`/`umami` password, create a website entry, and add the resulting tracking snippet to `bereshit-treebank.html` before `</head>` (there's only the one entry page here, unlike the multi-page app the original analytics writeup was for).

## Ongoing maintenance

- **Updates**: `rsync` (or `git pull`) the changed files to the VPS, then `docker compose up -d --force-recreate caddy` if `docker-compose.yml` changed — a plain `restart` won't pick up an edited inline config. Otherwise there's nothing to restart at all, since Caddy reads the bind-mounted files live and there's no image to rebuild.
- **Logs/monitoring**: `docker compose logs`, Hostinger's resource graphs in hPanel.
- **Backups**: stateless — the WLC/SBLGNT XML and the HTML page are the only state, so "the repo/rsync source" is the backup. No database, no volume to snapshot (aside from Caddy's own `caddy_data` cert cache, which just re-issues from Let's Encrypt if lost).
- **Rollback**: keep the previous copy of the three files around, or `git checkout <previous-tag>` and re-sync — there's no image tag to pin since nothing is built.
