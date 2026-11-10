# Shelf

A private, local-first web interface and Docker Compose deployment for
[benriemer/o-reilly-downloader](https://github.com/benriemer/o-reilly-downloader).
Shelf queues book and course downloads, streams progress and logs, manages
authentication cookies, and serves the finished library from one small dark UI.

The original downloader CLI is unchanged. Shelf runs it inside an isolated
worker container and talks to it through a lightweight internal adapter.

> **Authorized content only.** Use Shelf with an active O'Reilly subscription
> and only for material you are licensed to download. Shelf does not bypass
> DRM, paywalls, or access controls.

---

## Contents

- [What you get](#what-you-get)
- [Quick start](#quick-start)
- [Configuration](#configuration)
- [Architecture](#architecture)
- [Using Shelf](#using-shelf)
- [Cookie setup](#cookie-setup)
- [Library and volumes](#library-and-volumes)
- [Security model](#security-model)
- [Reverse proxy and HTTPS](#reverse-proxy-and-https)
- [Development and tests](#development-and-tests)
- [CLI usage](#cli-usage)
- [Troubleshooting](#troubleshooting)
- [Project layout](#project-layout)
- [Acknowledgments](#acknowledgments)

---

## What you get

- **Async download queue** for books (EPUB/PDF) and video courses
  (MP4 + transcripts), with concurrency controls.
- **Live job view** with progress, status, sanitized logs, cancellation, and
  one-click retry.
- **Library browser** for books and courses, with direct file downloads and
  byte-range streaming for media players.
- **Cookie management** in Settings, including validity metadata and file age.
  Cookie values are never returned to the browser or written to logs.
- **Two-container isolation**: the web app cannot run downloads directly, and
  the downloader API has no published port.
- **Local-only by default**: the UI binds to `127.0.0.1` and can optionally be
  password protected.

The downloader image is large (roughly 4 GB) because it includes Chromium,
ffmpeg, calibre, and Playwright. The first build takes about 5–10 minutes.

---

## Quick start

Prerequisites:

- Docker with the Compose plugin
- An active O'Reilly subscription
- Cookies for the content you want to download

Start the stack:

```bash
git clone https://github.com/benriemer/o-reilly-downloader.git
cd o-reilly-downloader

cp .env.example .env
# Recommended: set APP_PASSWORD and SESSION_SECRET in .env (see below).

docker compose up -d --build
```

Open <http://127.0.0.1:3000>.

On first use:

1. Go to **Settings → Cookie files** and add `cookies.json` (books) and/or
   `cookies_full.json` (courses). See [Cookie setup](#cookie-setup).
2. Go to **New download**, choose a book or course, and start the job.
3. Follow progress under **Activity**. Finished files appear in **Library**.

Useful commands:

```bash
docker compose ps
docker compose logs -f web
docker compose logs -f downloader
docker compose down            # keep downloads, cookies, and job history
docker compose down -v         # also remove job history (named volume)
```

`docker compose down` does **not** delete `./download`, `./config`, or the
`downloader-data` volume unless you pass `-v`.

---

## Configuration

Copy `.env.example` to `.env` and adjust:

```bash
cp .env.example .env
```

Generate secrets with:

```bash
openssl rand -base64 24   # APP_PASSWORD
openssl rand -hex 32      # SESSION_SECRET
openssl rand -hex 32      # INTERNAL_API_TOKEN (optional)
```

### Web access

| Variable | Default | Description |
| --- | --- | --- |
| `WEB_BIND` | `127.0.0.1` | Host interface for the web port. Keep loopback unless you put a password-protected reverse proxy in front. |
| `WEB_PORT` | `3000` | Host port for the web UI. |
| `APP_PASSWORD` | empty | Enables the login screen when set. Empty means local-only mode with no login. |
| `SESSION_SECRET` | random per start | Signs session cookies. Set it to keep sessions across restarts. |
| `SESSION_TTL_SECONDS` | `604800` | Session lifetime (7 days). Minimum 15 minutes. |
| `COOKIE_SECURE` | `0` | Set to `1` when the UI is served over HTTPS. |
| `TRUST_PROXY` | `0` | Set to `1` only behind a reverse proxy that supplies `X-Forwarded-*` headers. |

If `APP_PASSWORD` is empty, Shelf starts in **local-only mode**: anyone who can
reach the port has full access, so do not expose it beyond loopback. If you set
`APP_PASSWORD`, all API routes require a signed session cookie.

### Downloader

| Variable | Default | Description |
| --- | --- | --- |
| `INTERNAL_API_TOKEN` | empty | Optional shared secret between web and worker. The worker port is never published either way. |
| `MAX_CONCURRENT` | `1` | Simultaneous download jobs (capped at 4 by the worker). `1` is recommended. |
| `TZ` | `UTC` | Timezone for logs and timestamps. |
| `LOCAL_UID` / `LOCAL_GID` | `1000` / `1000` | Host UID/GID the web container uses to write `./config`. Match with `id -u` / `id -g`. |

Image overrides are available as `DOWNLOADER_IMAGE` and `WEB_IMAGE`.

---

## Architecture

```text
                 ┌──────────────────────────── host ───────────────────────────┐
                 │                                                             │
  Browser ──────▶│  web :3000 (published on 127.0.0.1 by default)              │
                 │   • static UI + JSON API                                    │
                 │   • password/session auth                                   │
                 │   • library index and file streaming (read-only)            │
                 │   • cookie status; writes cookie files                      │
                 │            │ internal HTTP + optional token                 │
                 │            ▼                                                │
                 │  downloader :8081 (no published port)                       │
                 │   • worker.py queue, progress parser, log redaction         │
                 │   • invokes the unchanged upstream CLI:                     │
                 │       docker-entrypoint.sh book|course                      │
                 │                                                             │
                 │  ./download ◀── both containers ──▶ ./config                │
                 │  downloader-data (named volume: job history)                │
                 └─────────────────────────────────────────────────────────────┘
```

- **web** is a zero-dependency Node 22 server and vanilla ES-module frontend.
  It runs read-only with all capabilities dropped.
- **downloader** contains the original upstream scripts plus
  `downloader/worker.py`, a small adapter that manages subprocesses and exposes
  only an internal API. It does **not** receive the Docker socket.
- The worker links the shared cookie files into the paths the upstream scripts
  expect, so the original download logic remains untouched.

---

## Using Shelf

### New download

- **Book**: enter the numeric book ID from the O'Reilly URL, a filesystem-safe
  title, and choose PDF, EPUB, or both. Example ID: `9780321635754`.
- **Course**: paste the course URL, for example
  `https://learning.oreilly.com/course/building-ai-agents/0642572077884/`.
  Transcripts-only mode is available.

The queue persists job metadata in the `downloader-data` volume. Queued jobs
resume after a restart; jobs that were running are marked interrupted, so use
**Retry** to run them again. Existing course videos are skipped by the upstream
downloader, so retries resume rather than start over.

### Activity

The job detail view shows status, timing, exit code, progress, and the latest
log tail. Logs are ANSI-stripped and redacted: known cookie values, Kaltura
tokens, JWTs, and session identifiers never reach the browser. Cancelling a job
terminates its subprocess tree.

### Library

Library scans are cached briefly and can be refreshed on demand. Books are
grouped by format; courses show module/lesson structure. Files stream through
the web server with HTTP range support, so large MP4s can be played or resumed.
The web container mounts `./download` read-only.

### Settings

Settings shows cookie status (configured, valid, count, size, modification
time), worker health, session details, concurrency, timezone, and path
information. Cookie **values** are never displayed, logged, or returned by the
API.

---

## Cookie setup

Shelf reads two files from `./config`:

| File | Used for |
| --- | --- |
| `cookies.json` | EPUB / PDF book downloads |
| `cookies_full.json` | Video courses, including HttpOnly session cookies |

You can add them in **Settings → Cookie files** or place them in `./config`
manually. Files are written with mode `600`.

### Book cookies (`cookies.json`)

1. Sign in at <https://learning.oreilly.com>.
2. Open DevTools → Console and run:

   ```js
   JSON.stringify(document.cookie.split(';').reduce((o, c) => {
     const [k, v] = c.trim().split('=');
     o[k] = v;
     return o;
   }, {}))
   ```

3. Paste the resulting JSON into Settings, or save it as
   `config/cookies.json`.

### Course cookies (`cookies_full.json`)

Course playback needs HttpOnly cookies that `document.cookie` cannot expose.
Capture them with the upstream interactive login or a browser extension that
exports HttpOnly cookies. The upstream login requires a display:

```bash
# Writes cookies_full.json into ./config when run from the repo root.
docker run --rm -it \
  -w /app/output \
  -e DISPLAY="$DISPLAY" \
  -v /tmp/.X11-unix:/tmp/.X11-unix:ro \
  -v "$PWD/config":/app/output \
  oreilly-downloader:latest login
```

Then paste the file contents into Settings if needed. Alternatively, run
`./oreilly.sh login` and move the resulting `cookies_full.json` into
`./config`.

Cookies expire. Settings shows when each file was last updated; refresh them if
downloads fail authentication. See [`config/README.md`](config/README.md) for
permission details.

---

## Library and volumes

| Host path | Container path | Access |
| --- | --- | --- |
| `./download` | `/app/download` (downloader) | read/write, finished library |
| `./download` | `/downloads` (web) | read-only, streaming |
| `./config` | `/config` (downloader) | read-only |
| `./config` | `/config` (web) | read/write, cookie management |
| named `downloader-data` | `/data` (downloader) | job metadata and logs |

Expected output layout:

```text
download/
├── epub/<title>.epub
├── pdf/<title>.pdf
└── courses/course-<id>/<module>/<lesson>.mp4
                                  └── <lesson>.txt
```

The host directories are created automatically by Compose if missing. On
SELinux hosts, the `:z` volume labels in `docker-compose.yml` handle relabeling.
If cookie saves fail with a permission error, set `LOCAL_UID`/`LOCAL_GID` to
match the owner of `./config`:

```bash
sudo chown -R "$(id -u):$(id -g)" config
```

---

## Security model

- **No published worker port.** The downloader API exists only on the Compose
  network. `INTERNAL_API_TOKEN` adds a second layer when set.
- **No Docker socket.** The worker invokes the upstream entrypoint directly.
- **Read-only web container.** Dropped capabilities, `no-new-privileges`, a
  read-only root filesystem, and only `./config` plus a small `/tmp` writable.
- **Cookie confidentiality.** The frontend submits cookie JSON but never reads
  it back. Status endpoints return metadata only. Worker logs redact cookie
  values and token-like strings.
- **CSRF and origin checks.** State-changing requests must be same-origin, and
  sessions use `HttpOnly`, `SameSite=Lax` cookies.
- **Security headers.** CSP, `X-Content-Type-Options`, frame denial, and a
  restrictive referrer policy are set by the web server.
- **Authorized use.** The tool relies on your O'Reilly session and does not
  circumvent DRM or entitlement checks.

For internet-facing deployments, set a strong `APP_PASSWORD`, a stable
`SESSION_SECRET`, serve over HTTPS with `COOKIE_SECURE=1`, and place the app
behind a reverse proxy. Never commit `.env`, `./config/*.json`, or downloaded
content; all three are covered by `.gitignore`.

---

## Reverse proxy and HTTPS

Example Caddy configuration:

```caddyfile
shelf.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

Set in `.env`:

```dotenv
WEB_BIND=127.0.0.1
APP_PASSWORD=use-a-long-random-password
SESSION_SECRET=use-a-stable-random-secret
COOKIE_SECURE=1
TRUST_PROXY=1
```

`TRUST_PROXY=1` trusts `X-Forwarded-Proto` and `X-Forwarded-Host` for origin
checks. Enable it only when the app is reachable exclusively through the proxy.

---

## Development and tests

Run the web server locally without Docker:

```bash
cd web
PORT=3000 \
DOWNLOADS_DIR="$PWD/../download" \
CONFIG_DIR="$PWD/../config" \
WORKER_URL=http://127.0.0.1:8081 \
APP_PASSWORD=test \
node server/index.js
```

Run the tests:

```bash
cd web && npm test

cd ..
python3 -m unittest discover -s downloader -p 'test_*.py' -v
```

The Node suite covers auth, CSRF, cookie handling without value leakage,
library traversal protection, range requests, and API routing. The Python suite
uses a mock CLI to exercise queueing, progress parsing, redaction,
cancellation, and worker lifecycle. The tests do not need Docker or real
cookies.

Node 22+ is required for the web app. Python 3.10+ is recommended for the
worker tests.

---

## CLI usage

The upstream CLI remains available independently of the web UI.

### Build the image

```bash
docker build -t oreilly-downloader:latest .
```

The image is based on `kirinnee/orly:latest` and includes Chromium, ffmpeg,
calibre, Playwright, and the upstream downloader scripts.

### Download a book

```bash
./oreilly.sh book -b 9780321635754 -t art-of-computer -f both
```

| Argument | Flag | Values |
| --- | --- | --- |
| Book ID | `-b` | numeric ID from the O'Reilly URL |
| Title | `-t` | filesystem-safe title, no spaces |
| Format | `-f` | `pdf`, `epub`, or `both` |

Output: `download/epub/<title>.epub` and `download/pdf/<title>.pdf`.

### Download a course

```bash
./oreilly.sh course "https://learning.oreilly.com/course/building-ai-agents/0642572077884/"

# Transcripts only
./oreilly.sh course "https://learning.oreilly.com/course/building-ai-agents/0642572077884/" --transcripts-only
```

Courses are saved under `download/courses/course-<id>/<module>/<lesson>.mp4`.
Existing non-zero video files are skipped, so re-running a course resumes a
partial download. The downloader refreshes Kaltura tokens periodically and
retries transient TLS/EOF failures.

When using the CLI directly, cookies live in the repository root
(`./cookies.json`, `./cookies_full.json`) rather than `./config`. The wrapper
mounts them automatically.

### Upstream interactive login

```bash
./oreilly.sh login
```

This requires an X11 display and writes `cookies_full.json` into the repository
root. See [Cookie setup](#cookie-setup) for the container command that writes
directly into `./config`.

---

## Troubleshooting

### The UI loads but says the worker is offline

```bash
docker compose ps
docker compose logs downloader
```

The web container waits for the downloader health check before starting. A
worker that keeps restarting usually indicates a missing image or a permissions
problem on `./download`.

### Cookies cannot be saved

The web container runs as `LOCAL_UID:LOCAL_GID` and must own `./config`:

```bash
sudo chown -R "$(id -u):$(id -g)" config
```

or update `LOCAL_UID` / `LOCAL_GID` in `.env` and restart.

### Login fails or downloads report authentication errors

Cookies have likely expired. Re-export them, update Settings, and retry the job.
O'Reilly no longer supports programmatic username/password login.

### `UNEXPECTED_EOF_WHILE_READING` or Akamai timeouts

O'Reilly sits behind Akamai, which can close TLS handshakes or temporarily rate
limit an IP. Wait 15–60 minutes, refresh cookies, or try a different network.
The downloader image uses Debian 12's OpenSSL 3.0.x for compatibility.

### Course video fails repeatedly

- Re-run the job; completed videos are skipped.
- Confirm `cookies_full.json` is present and recent.
- Verify ffmpeg inside the image:
  `docker run --rm --entrypoint ffmpeg oreilly-downloader:latest -version`.

### "download failed - the epub is empty or invalid"

Usually expired cookies or an incorrect book ID. Check the job log, refresh
cookies, and retry.

### First build is slow or runs out of disk

The downloader image is ~4 GB and includes Chromium, calibre, and ffmpeg. Allow
at least 10 GB of free space for images, downloads, and build cache. The web
image itself is small.

### Sessions reset after every restart

Set `SESSION_SECRET` in `.env`. Without it, the server generates a random secret
at startup.

---

## Project layout

```text
.
├── docker-compose.yml        # web + downloader services, volumes, healthchecks
├── .env.example              # configuration template
├── Dockerfile                # upstream downloader image + worker adapter
├── downloader/
│   ├── worker.py             # internal queue/API adapter around the CLI
│   └── test_*.py             # mock-CLI worker tests
├── web/
│   ├── Dockerfile            # Node 22 Alpine image
│   ├── server/               # zero-dependency HTTP API, auth, cookies, library
│   ├── public/               # vanilla ES modules, CSS, fonts, favicon
│   └── test/                 # Node test suite
├── config/                   # cookie files (gitignored), shared with containers
└── download/                 # finished library (gitignored)
```

The original upstream scripts (`docker-entrypoint.sh`,
`oreilly-course-downloader.py`, `safaribooks-v2.py`, and related files) are
kept as-is.

---

## Acknowledgments

- [Kirin nee](https://github.com/kirinnee) — base Docker image
- [Calibre](https://calibre-ebook.com/get-involved)
- [lorenzodifuccia/safaribooks](https://github.com/lorenzodifuccia/safaribooks)
  — underlying book downloader
- [sohailnajar/safaribooks](https://github.com/lorenzodifuccia/safaribooks/pull/377)
  — v2 API migration and cookie-auth fix

## Author

[@benriemer](https://github.com/benriemer)

## License

See [`LICENSE`](LICENSE).
