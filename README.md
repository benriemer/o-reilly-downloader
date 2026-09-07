<p align="center">
  <a href="" rel="noopener">
 <img width=200px height=200px src="https://www.codegrepper.com/profile_images/577485_lnuxr2sSE6gZJmlrr5h9oITqE8lUbMPCpaFSel94VRGDIK8N5Zbthqn.png" alt="Project logo"></a>
</p>

<h1 align="center">O-Reilly-Downloader</h1>
<br>
<br>
<div align="center">

[![Status](https://img.shields.io/badge/status-active-success.svg)]()
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](/LICENSE)
<br>

</div>

---

<p align="center">Download e-books (EPUB/PDF) and video courses (MP4 + transcripts) from O'Reilly Learning
    <br>
</p>
<br>
<br>
<br>

## Table of Contents

- [About](#about)
- [Docker Quick Start](#docker_quick_start)
- [Prerequisites](#prerequisites)
- [Cookie Authentication](#cookie_auth)
- [Downloading Books](#downloading_books)
- [Downloading Courses](#downloading_courses)
- [Interactive Login (Full Cookies)](#login)
- [Building the Docker Image](#building)
- [Troubleshooting](#troubleshooting)
- [Special Thanks](#special_thanks)
- [Authors](#authors)

<br><br>

## About <a name = "about"></a>

A unified Docker-based CLI to download **books** (EPUB/PDF) and **video courses** (MP4 + transcripts) from <https://learning.oreilly.com/>.

The entire toolchain runs inside a single Docker image — no host-side Python, Playwright, ffmpeg, or calibre installation required.

<br><br>

## Docker Quick Start <a name = "docker_quick_start"></a>

```bash
# 1. Build the image
docker build -t oreilly-downloader:latest .

# 2. Get cookies (see Cookie Authentication below)

# 3. Download a book
./oreilly.sh book -b 0642572274566 -t the-agentic-enterprise -f both

# 4. Download a video course
./oreilly.sh course "https://learning.oreilly.com/course/building-ai-agents/0642572077884/"
```

The wrapper script `oreilly.sh` handles volume mounts automatically. You can also use `docker run` directly — see below.

<br><br>

## Prerequisites <a name = "prerequisites"></a>

- **Docker** — the only host-side requirement
- **O'Reilly subscription** — an active account with access to the content you want to download
- **Cookies** — see [Cookie Authentication](#cookie_auth)

> No need to install Python, Playwright, Chromium, ffmpeg, or calibre on the host.
> Everything runs inside the Docker container.

<br><br>

## Cookie Authentication <a name = "cookie_auth"></a>

> **Important:** O'Reilly no longer allows username/password login via scripts.
> Authentication is done via browser cookies.

### For Books: `cookies.json`

1. Log in at <https://learning.oreilly.com> in your browser
2. Open the developer console (`F12`) on that page
3. Run this JavaScript and copy the output:
   ```js
   JSON.stringify(document.cookie.split(';').reduce((o,c)=>{let[k,v]=c.trim().split('=');o[k]=v;return o;},{}))
   ```
4. Save the output as `cookies.json` in the script directory

Alternatively, use the helper:
```sh
python3 retrieve_cookies.py --paste
# or auto-extract from browser:
pip install browser_cookie3
python3 retrieve_cookies.py -b chrome
```

### For Courses: `cookies_full.json`

Course downloads need **full cookies** including `HttpOnly` cookies (like `groot_sessionid`, `orm-jwt`, `orm-rt`) that `document.cookie` cannot access. Use the interactive login mode:

```sh
./oreilly.sh login
```

This opens a real Chrome browser, lets you log in, and captures all cookies into `cookies_full.json`. Requires X11 forwarding (see [Interactive Login](#login)).

> **Cookies expire.** If you get authentication errors, re-extract your cookies.

<br><br>

## Downloading Books <a name = "downloading_books"></a>

### Using the wrapper script

```sh
./oreilly.sh book -b 9780321635754 -t art-of-computer -f pdf
```

### Using docker run directly

```sh
docker run --rm \
  -v "$PWD/cookies.json":/app/cookies.json:ro \
  -v "$PWD/download":/app/download \
  oreilly-downloader:latest \
  book -b 9780321635754 -t art-of-computer -f both
```

| argument    | flag | explanation | example |
| ----------- | ---- | ----------- | ------- |
| `book id`   | `-b` | the ID of the book (found in the O'Reilly URL) | `9780321635754` |
| `title`     | `-t` | the title of the book - no spaces | `art-of-computer` |
| `format`    | `-f` | output format: `pdf`, `epub`, or `both` | `both` |

Files are saved to:
- `download/epub/<title>.epub`
- `download/pdf/<title>.pdf`

<br><br>

## Downloading Courses <a name = "downloading_courses"></a>

### Using the wrapper script

```sh
# Download videos + transcripts
./oreilly.sh course "https://learning.oreilly.com/course/building-ai-agents/0642572077884/"

# Download transcripts only (no video files)
./oreilly.sh course "https://learning.oreilly.com/course/building-ai-agents/0642572077884/" --transcripts-only
```

### Using docker run directly

```sh
docker run --rm \
  -v "$PWD/cookies_full.json":/app/cookies_full.json:ro \
  -v "$PWD/download":/app/download \
  oreilly-downloader:latest \
  course "https://learning.oreilly.com/course/building-ai-agents/0642572077884/"
```

### How it works

1. Launches headless Chromium with your cookies
2. Scrapes the course page to extract modules and lesson video URLs
3. For each lesson:
   - Queries the O'Reilly VideoClip API for metadata + transcripts
   - Gets a Kaltura session token
   - Resolves the HLS `.m3u8` stream URL via Kaltura's API
   - Downloads the video with `ffmpeg`
   - Saves the transcript as `.txt`
4. Organizes output as `download/courses/course-<id>/<module>/<lesson>.mp4`

### Resume behavior

The downloader skips videos that already exist with non-zero file size. If a download fails, it refreshes the Kaltura session token and retries. You can re-run the same command to resume a partial download.

### Kaltura session refresh

The Kaltura `ks` token has a limited lifetime. The downloader automatically:
- Refreshes the token every 5 minutes
- Refreshes on failure and retries with the new token
- Retries ffmpeg on transient TLS/EOF errors (up to 2 retries)

<br><br>

## Interactive Login (Full Cookies) <a name = "login"></a>

Course downloads require `cookies_full.json` with `HttpOnly` cookies. The interactive login mode opens a real browser:

```sh
# On Linux with X11:
./oreilly.sh login

# Or with docker run:
docker run --rm \
  -e DISPLAY=$DISPLAY \
  -v /tmp/.X11-unix:/tmp/.X11-unix:ro \
  -v "$PWD":/app/output \
  oreilly-downloader:latest \
  login
```

This opens Chrome, you log in to O'Reilly, and it captures all cookies (including `HttpOnly` ones) into `cookies_full.json`.

<br><br>

## Building the Docker Image <a name = "building"></a>

```sh
docker build -t oreilly-downloader:latest .
```

The image is based on `kirinnee/orly:latest` (Debian 12 / Bookworm) and includes:
- **Chromium** — headless browser for Playwright (course page scraping)
- **ffmpeg** — HLS video download
- **calibre** (`ebook-convert`) — EPUB to PDF conversion
- **Playwright + requests** — Python browser automation and API calls
- **sso wrapper + safaribooks-v2.py** — book download via O'Reilly API v2

The image is ~4 GB. Build time is ~5-10 minutes depending on network speed.

<br><br>

## Troubleshooting <a name = "troubleshooting"></a>

### SSL error: `UNEXPECTED_EOF_WHILE_READING`

O'Reilly is fronted by Akamai, which can close TLS handshakes to `learning.oreilly.com`. The Docker image uses Debian 12's OpenSSL 3.0.x which is compatible. If you still see this error:

- Wait 15-30 minutes — Akamai may be temporarily rate-limiting your IP
- Re-extract your cookies — they may have expired
- Try from a different network/VPN

### Akamai IP block (connection timeout)

If you've downloaded a lot of content in a short time, Akamai may temporarily block your IP. Symptoms:
- TCP connects but TLS handshake times out
- `ERR_CONNECTION_CLOSED` in Playwright
- `000` status from curl

**Fix:** Wait 15-60 minutes for the block to expire, or use a VPN.

### Login fails / authentication error

O'Reilly blocked username/password programmatic login. You must use [cookie-based authentication](#cookie_auth). If it still fails, your cookies have likely expired — re-extract them.

### "download failed - the epub is empty or invalid"

The download did not complete. Check the docker output above the error. Most commonly this is expired cookies or an incorrect book ID.

### Course video fails with TLS/EOF errors

The Kaltura session token may have expired. The downloader automatically refreshes it and retries. If failures persist:
- Re-run the command — existing videos are skipped
- Check that `cookies_full.json` is still valid
- Ensure ffmpeg is working (`docker run --rm --entrypoint ffmpeg oreilly-downloader:latest -version`)

### `cookies_full.json` not found

Course downloads need full cookies including `HttpOnly` session cookies. Run `./oreilly.sh login` to capture them. See [Interactive Login](#login).

<br><br>

## Acknowledgment <a name = "special_thanks"></a>

- [Kirin nee](https://github.com/kirinnee) — [base Docker image](https://github.com/kirinnee/oreilly-downloader)
- [Calibre Project](https://calibre-ebook.com/get-involved)
- [lorenzodifuccia/safaribooks](https://github.com/lorenzodifuccia/safaribooks) — the underlying book downloader
- [sohailnajar/safaribooks](https://github.com/lorenzodifuccia/safaribooks/pull/377) — v2 API migration and cookie-auth fix

<br>

## Authors <a name = "authors"></a>

- [@benriemer](https://github.com/benriemer)
