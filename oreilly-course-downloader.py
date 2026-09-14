#!/usr/bin/env python3
"""
O'Reilly Course Downloader

Downloads O'Reilly video courses (videos + transcripts) for offline personal use.

Architecture:
  1. Uses Playwright (headless Chrome) to load the course page and extract video links
  2. Gets a Kaltura session (ks) token via the O'Reilly API (using full cookies)
  3. For each video clip, queries the O'Reilly VideoClip API for the kaltura_entry_id
  4. Uses the Kaltura API to resolve the HLS .m3u8 stream URL
  5. Downloads each video with ffmpeg

Prerequisites:
  - Python 3.12+ with: playwright, requests
  - System Chrome/Chromium installed
  - ffmpeg in PATH (or use --ffmpeg /path/to/ffmpeg)
  - Full O'Reilly cookies in cookies_full.json (run oreilly-login.py first to get them)

Usage:
  python3 oreilly-course-downloader.py <course_url> [--output-dir DIR] [--transcripts-only]

Example:
  python3 oreilly-course-downloader.py "https://learning.oreilly.com/course/building-ai-agents/0642572077884/"

To get full cookies (needed for video downloads):
  python3 oreilly-login.py
"""

import argparse
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

import requests
from playwright.sync_api import sync_playwright

# ─── Constants ───────────────────────────────────────────────────────────────

CHROME_PATH = os.environ.get("CHROME_PATH", "/usr/bin/google-chrome")
COOKIES_FILE = "cookies_full.json"
KALTURA_PARTNER_ID = "1926081"
KALTURA_API_URL = "https://cdnapisec.kaltura.com/api_v3/service/multirequest"
VIDEOCLIP_API = "https://learning.oreilly.com/api/v1/videoclips/{clip_id}/"
KS_API = "https://learning.oreilly.com/api/v1/player/kaltura_session/"


# ─── Helpers ─────────────────────────────────────────────────────────────────


def load_cookies():
    """Load cookies from cookies_full.json (preferred) or cookies.json."""
    for path in [COOKIES_FILE, "cookies.json", "data/cookies.json"]:
        if os.path.isfile(path):
            with open(path) as f:
                cookies = json.load(f)
            print(f"  Loaded cookies from {path} ({len(cookies)} cookies)")
            return cookies, path
    print("Error: No cookies file found.")
    print("  Run `python3 oreilly-login.py` first to capture full cookies.")
    sys.exit(1)


def sanitize_filename(name):
    """Remove characters that are invalid in filenames."""
    name = re.sub(r'[<>:"/\\|?*]', '_', name).strip()
    name = re.sub(r'\s+', ' ', name)
    # Truncate to reasonable length
    if len(name) > 150:
        name = name[:150]
    return name


# ─── Course Scraper ──────────────────────────────────────────────────────────


def scrape_course_structure(page, course_url):
    """
    Navigate to the course page and extract the video structure.
    Returns a dict: { chapter_title: [{ title, url, clip_id }] }
    """
    print(f"  Navigating to course page...")
    page.goto(course_url, wait_until="domcontentloaded", timeout=60000)
    time.sleep(8)

    # Scroll to bottom to trigger lazy loading
    page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
    time.sleep(2)

    # Expand all accordion sections
    print("  Expanding course chapters...")
    page.evaluate("""
    () => {
        const headers = document.querySelectorAll('button[aria-expanded="false"]');
        headers.forEach(h => {
            try { h.click(); } catch(e) {}
        });
        // Also try MuiAccordion headers
        const muiHeaders = document.querySelectorAll('button.MuiAccordionSummary-root');
        muiHeaders.forEach(h => {
            if (h.getAttribute('aria-expanded') !== 'true' && !h.classList.contains('Mui-expanded')) {
                h.click();
            }
        });
    }
    """)
    time.sleep(3)

    # Scrape the full structure
    structure = page.evaluate("""
    () => {
        const result = {};
        const isVideoLink = (href) => {
            if (!href) return false;
            if (href.includes('/continue/') || href.includes('/start/')) return false;
            return href.includes('/videos/') && /\\d{10,13}-[a-zA-Z0-9_-]+/.test(href);
        };
        const cleanTitle = (text) => {
            return (text || '').trim()
                .replace(/Complete$/i, '')
                .replace(/\\d+[smh](\\s+\\d+[sm])?(\\s*remaining)?\\s*$/i, '')
                .replace(/\\d+m\\s+\\d+s$/i, '')
                .replace(/\\d+h\\s+\\d+m\\s+\\d+s$/i, '')
                .replace(/\\d+h\\s+\\d+m$/i, '')
                .trim();
        };

        const headers = document.querySelectorAll('button.MuiAccordionSummary-root');

        if (headers.length === 0) {
            // Fallback: find all video links directly
            const allLinks = Array.from(document.querySelectorAll('a'))
                .filter(a => isVideoLink(a.getAttribute('href')));

            const videos = allLinks.map(link => ({
                title: cleanTitle(link.textContent),
                url: link.href
            })).filter(v => v.title && v.url);

            if (videos.length > 0) result['Course Content'] = videos;
            return result;
        }

        for (let i = 0; i < headers.length; i++) {
            const header = headers[i];
            let moduleTitle = '';
            const heading = header.querySelector('h3, h4, h5, h2');
            moduleTitle = heading ? heading.textContent.trim() : (header.textContent || '').trim();
            moduleTitle = moduleTitle.split('\\n')[0].trim() || `Chapter ${i + 1}`;

            const controlsId = header.getAttribute('aria-controls');
            let panel = controlsId ? document.getElementById(controlsId) : null;
            if (!panel) panel = header.nextElementSibling;

            if (panel) {
                const links = Array.from(panel.querySelectorAll('a'))
                    .filter(a => isVideoLink(a.getAttribute('href')));

                const videos = links.map(link => ({
                    title: cleanTitle(link.textContent),
                    url: link.href
                })).filter(v => v.title && v.url);

                if (videos.length > 0) result[moduleTitle] = videos;
            }
        }
        return result;
    }
    """)

    return structure


def extract_clip_id(video_url):
    """Extract the O'Reilly video clip ID from a URL.
    Supports both formats:
      /videos/-/0642572077884/0642572077884-video381607/  (numeric suffix)
      /videos/-/9781807785192/9781807785192-video1_1/      (underscore suffix)
    """
    # Match pattern: {digits}-video{digits} optionally followed by _{digits}
    match = re.search(r'(\d{10,13}-video\d+(?:_\d+)?)', video_url)
    if match:
        return match.group(1)
    # Fallback: ISBN-like pattern (e.g. 9780135887837-aaic1_01_01_01)
    match = re.search(r'\b(\d{10,13}-[a-zA-Z0-9_]+)\b', video_url)
    if match:
        return match.group(1)
    return None


# ─── Video Resolver ──────────────────────────────────────────────────────────


class VideoResolver:
    """Resolves HLS .m3u8 URLs for O'Reilly video clips via the Kaltura API."""

    def __init__(self, session, ks_token):
        self.session = session
        self.ks = ks_token
        self._ks_expiry = time.time() + 300  # Assume 5 min validity, refresh proactively

    def refresh_ks(self):
        """Refresh the Kaltura session token."""
        try:
            resp = self.session.get(KS_API, timeout=20)
            if resp.status_code == 200:
                data = resp.json()
                new_ks = data.get("ks") or data.get("kaltura_session") or data.get("session")
                if new_ks:
                    self.ks = new_ks
                    self._ks_expiry = time.time() + 300
                    print(f"    [Refreshed Kaltura session]")
                    return True
        except Exception as e:
            print(f"    [Failed to refresh Kaltura session: {e}]")
        return False

    def resolve_clip(self, clip_id):
        """Resolve a video clip to (m3u8_url, transcript_text).
        Returns (None, transcript) if video URL can't be resolved but transcript exists.
        Returns (None, None) if nothing works.
        """
        # Refresh ks if it's close to expiring
        if time.time() > self._ks_expiry:
            self.refresh_ks()

        clip_url = VIDEOCLIP_API.format(clip_id=clip_id)

        try:
            resp = self.session.get(clip_url, timeout=20)
        except requests.RequestException as e:
            print(f"    Request error for {clip_id}: {e}")
            return None, None

        if resp.status_code != 200:
            print(f"    VideoClip API returned {resp.status_code} for {clip_id}")
            return None, None

        data = resp.json()

        # Extract transcript if available
        transcript = None
        transcriptions = data.get("transcriptions", [])
        if transcriptions:
            try:
                trans_obj = next(
                    (t for t in transcriptions if t.get("language") == "en"),
                    transcriptions[0],
                )
                lines_data = trans_obj.get("transcription", {}).get("lines", [])
                formatted_lines = []
                for line in lines_data:
                    begin = line.get("begin", "")
                    parts = begin.split(".")
                    time_str = parts[0] if parts else "00:00:00"
                    if time_str.startswith("00:"):
                        time_str = time_str[3:]
                    text = line.get("text", "").strip()
                    if text:
                        formatted_lines.append(f"[{time_str}] {text}")
                if formatted_lines:
                    transcript = "\n".join(formatted_lines)
            except Exception:
                pass

        entry_id = data.get("kaltura_entry_id")
        if not entry_id:
            print(f"    No kaltura_entry_id for {clip_id}")
            return None, transcript

        # Query Kaltura for the HLS URL
        payload = {
            "1": {
                "service": "baseEntry",
                "action": "getPlaybackContext",
                "entryId": entry_id,
                "ks": self.ks,
                "contextDataParams": {
                    "objectType": "KalturaContextDataParams",
                    "flavorTags": "all",
                },
            },
            "apiVersion": "3.3.0",
            "format": 1,
            "ks": self.ks,
            "clientTag": "html5:v3.17.86",
            "partnerId": KALTURA_PARTNER_ID,
        }

        try:
            playback_resp = self.session.post(KALTURA_API_URL, json=payload, timeout=20)
        except requests.RequestException as e:
            print(f"    Kaltura API error: {e}")
            return None, transcript

        if playback_resp.status_code != 200:
            print(f"    Kaltura API returned {playback_resp.status_code}")
            return None, transcript

        playback_data = playback_resp.json()
        context = playback_data[0] if isinstance(playback_data, list) else playback_data
        sources = context.get("sources", [])

        # Find HLS (applehttp) source
        hls_source = next((s for s in sources if s.get("format") == "applehttp"), None)
        if hls_source and hls_source.get("url"):
            url = hls_source["url"]
            # Append ks token if not present
            if self.ks and "/ks/" not in url:
                if "/a.m3u8" in url:
                    url = url.replace("/a.m3u8", f"/ks/{self.ks}/a.m3u8")
            return url, transcript

        # Fallback to direct URL source
        url_source = next((s for s in sources if s.get("format") == "url"), None)
        if url_source and url_source.get("url"):
            return url_source["url"], transcript

        print(f"    No HLS or URL streams found for {clip_id}")
        return None, transcript


# ─── Video Downloader ────────────────────────────────────────────────────────


def download_video(m3u8_url, output_path, ffmpeg_path="ffmpeg", retries=2):
    """Download an HLS stream to a file using ffmpeg. Retries on TLS errors."""
    for attempt in range(retries + 1):
        cmd = [
            ffmpeg_path,
            "-i", m3u8_url,
            "-c", "copy",  # Stream copy (no re-encoding)
            "-bsf:a", "aac_adtstoasc",
            "-y",  # Overwrite output file
            "-loglevel", "error",
            output_path,
        ]
        try:
            result = subprocess.run(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                timeout=600,
            )
            if result.returncode == 0:
                return True
            stderr = result.stderr.decode()[:300]
            if attempt < retries:
                # Check if it's a TLS/connection error that might benefit from a retry
                if "End of file" in stderr or "pull function" in stderr or "Connection" in stderr:
                    print(f"    ffmpeg TLS error (attempt {attempt+1}/{retries+1}), retrying in 3s...")
                    time.sleep(3)
                    continue
            print(f"    ffmpeg error: {stderr}")
            return False
        except subprocess.TimeoutExpired:
            print(f"    ffmpeg timed out")
            return False
        except FileNotFoundError:
            print(f"    ffmpeg not found at: {ffmpeg_path}")
            return False
    return False


# ─── Main ────────────────────────────────────────────────────────────────────


def main():
    parser = argparse.ArgumentParser(
        description="Download O'Reilly video courses for offline personal use."
    )
    parser.add_argument("course_url", help="O'Reilly course URL")
    parser.add_argument(
        "--output-dir", "-o", default="download/courses",
        help="Output directory (default: download/courses)"
    )
    parser.add_argument(
        "--transcripts-only", action="store_true",
        help="Download transcripts only (no video files)"
    )
    parser.add_argument(
        "--ffmpeg", default="ffmpeg",
        help="Path to ffmpeg binary"
    )
    args = parser.parse_args()

    # Load cookies
    print("=== O'Reilly Course Downloader ===")
    cookies, cookies_path = load_cookies()

    # Extract course ID from URL
    course_url = args.course_url.rstrip("/")
    course_id_match = re.search(r'/(\d{10,13})/?$', course_url)
    if not course_id_match:
        print(f"Error: Could not extract course ID from URL: {course_url}")
        sys.exit(1)
    course_id = course_id_match.group(1)

    # Set up output directory
    output_dir = Path(args.output_dir) / f"course-{course_id}"
    output_dir.mkdir(parents=True, exist_ok=True)

    # ── Phase 1: Scrape course structure with Playwright ──
    print("\n--- Phase 1: Scraping course structure ---")
    with sync_playwright() as p:
        browser = p.chromium.launch(
            executable_path=CHROME_PATH,
            headless=True,
            args=["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
        )
        context = browser.new_context()

        # Inject cookies
        cookie_list = []
        for name, value in cookies.items():
            cookie_list.append({
                "name": name,
                "value": value,
                "domain": ".oreilly.com",
                "path": "/",
            })
        context.add_cookies(cookie_list)

        page = context.new_page()

        # Scrape course structure
        structure = scrape_course_structure(page, course_url)

        if not structure:
            print("Error: Could not extract course structure.")
            print("  Make sure you're logged in and the course URL is correct.")
            print("  Try running `python3 oreilly-login.py` to refresh cookies.")
            browser.close()
            sys.exit(1)

        # Flatten structure and extract clip IDs
        total_videos = sum(len(videos) for videos in structure.values())
        print(f"  Found {len(structure)} chapters, {total_videos} videos")

        # Print chapter summary
        for chapter, videos in structure.items():
            print(f"    {chapter}: {len(videos)} videos")

        browser.close()

    # ── Phase 2: Get Kaltura session and set up API session ──
    print("\n--- Phase 2: Getting Kaltura session ---")
    session = requests.Session()
    session.headers.update({
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    })
    session.cookies.update(cookies)

    ks_resp = session.get(KS_API, timeout=20)
    if ks_resp.status_code != 200:
        print(f"Error: Kaltura session API returned {ks_resp.status_code}")
        print(f"  Response: {ks_resp.text[:200]}")
        print("  Your cookies may be expired. Run `python3 oreilly-login.py` to refresh.")
        sys.exit(1)

    ks_data = ks_resp.json()
    ks_token = ks_data.get("ks") or ks_data.get("kaltura_session") or ks_data.get("session")
    if not ks_token:
        print("Error: No ks token in Kaltura session response")
        sys.exit(1)
    print(f"  Kaltura session token acquired: {ks_token[:30]}...")

    # ── Phase 3: Download videos ──
    resolver = VideoResolver(session, ks_token)
    video_num = 0
    failed = []
    succeeded = 0

    mode = "transcripts only" if args.transcripts_only else "videos + transcripts"
    print(f"\n--- Phase 3: Downloading ({mode}) ---")

    for chapter_title, videos in structure.items():
        chapter_dir = output_dir / sanitize_filename(chapter_title)
        chapter_dir.mkdir(parents=True, exist_ok=True)

        for video in videos:
            video_num += 1
            title = sanitize_filename(video["title"])
            clip_id = extract_clip_id(video["url"])

            if not clip_id:
                print(f"  [{video_num}/{total_videos}] SKIP (no clip ID): {title}")
                continue

            print(f"  [{video_num}/{total_videos}] {title}")

            # Resolve the video
            m3u8_url, transcript = resolver.resolve_clip(clip_id)

            # Save transcript
            if transcript:
                transcript_path = chapter_dir / f"{title}.txt"
                with open(transcript_path, "w") as f:
                    f.write(transcript)
                print(f"    Transcript saved ({len(transcript)} chars)")

            # Download video
            if not args.transcripts_only:
                if m3u8_url:
                    video_path = chapter_dir / f"{title}.mp4"
                    if video_path.exists() and video_path.stat().st_size > 0:
                        print(f"    Already exists ({video_path.stat().st_size / 1048576:.1f} MB), skipping")
                        succeeded += 1
                        continue
                    print(f"    Downloading via ffmpeg...")
                    if download_video(m3u8_url, str(video_path), args.ffmpeg):
                        size_mb = video_path.stat().st_size / (1024 * 1024)
                        print(f"    Downloaded: {size_mb:.1f} MB")
                        succeeded += 1
                    else:
                        # Retry with fresh ks token
                        print(f"    Retrying with fresh Kaltura session...")
                        resolver.refresh_ks()
                        m3u8_url2, _ = resolver.resolve_clip(clip_id)
                        if m3u8_url2 and m3u8_url2 != m3u8_url:
                            if download_video(m3u8_url2, str(video_path), args.ffmpeg):
                                size_mb = video_path.stat().st_size / (1024 * 1024)
                                print(f"    Downloaded on retry: {size_mb:.1f} MB")
                                succeeded += 1
                            else:
                                print(f"    FAILED to download")
                                failed.append(f"{chapter_title}/{title}")
                        else:
                            print(f"    FAILED to download")
                            failed.append(f"{chapter_title}/{title}")
                else:
                    print(f"    No stream URL available")
                    if not transcript:
                        failed.append(f"{chapter_title}/{title}")
            else:
                if transcript:
                    succeeded += 1
                else:
                    failed.append(f"{chapter_title}/{title}")

            # Small delay to avoid rate limiting
            time.sleep(0.5)

    # ── Summary ──
    print(f"\n=== Complete ===")
    print(f"  Course ID: {course_id}")
    print(f"  Total videos: {total_videos}")
    print(f"  Succeeded: {succeeded}")
    print(f"  Failed: {len(failed)}")
    if failed:
        for f in failed:
            print(f"    - {f}")
    print(f"  Output: {output_dir}")


if __name__ == "__main__":
    main()
