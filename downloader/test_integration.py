"""End-to-end test of the internal worker API using a mock downloader CLI."""

from __future__ import annotations

import json
import os
import re
import socket
import subprocess
import sys
import tempfile
import textwrap
import time
import unittest
import urllib.error
import urllib.request
from pathlib import Path

TOKEN = "integration-worker-token"
COOKIE_SECRET = "integration-cookie-secret-value"
CHILD_TOKEN = "should-not-appear-in-logs-123456"

MOCK_CLI = textwrap.dedent(
    """\
    #!/usr/bin/env python3
    import os
    import re
    import sys
    import time
    from pathlib import Path

    DOWNLOAD = Path(os.environ["DOWNLOAD_DIR"])
    COOKIE_SECRET = os.environ["MOCK_COOKIE_SECRET"]
    CHILD_TOKEN = os.environ["MOCK_CHILD_TOKEN"]

    args = sys.argv[1:]
    if not args:
        sys.exit(2)

    if args[0] == "book":
        book_id = ""
        title = ""
        fmt = "both"
        index = 1
        while index < len(args):
            if args[index] == "-b":
                book_id = args[index + 1]
                index += 2
            elif args[index] == "-t":
                title = args[index + 1]
                index += 2
            elif args[index] == "-f":
                fmt = args[index + 1]
                index += 2
            else:
                index += 1
        print("Using cookies from: /app/cookies.json")
        print("Successfully authenticated.")
        print("Retrieving book info...")
        print("Retrieving book chapters...")
        print("Downloading book contents... (3 chapters)")
        print("Downloading book CSSs... (2 files)")
        print("Downloading book images... (4 files)")
        print("Creating EPUB file...")
        print(f"Using session {COOKIE_SECRET}")
        if "Cancel Me" in title:
            print("Cancel test started")
            sys.stdout.flush()
            time.sleep(30)
        epub_dir = DOWNLOAD / "epub"
        epub_dir.mkdir(parents=True, exist_ok=True)
        epub = epub_dir / f"{title}.epub"
        epub.write_bytes(b"PK\\x03\\x04mock-epub")
        print(f"Done: {epub}")
        if fmt in ("both", "pdf"):
            print("Converting to PDF...")
            pdf_dir = DOWNLOAD / "pdf"
            pdf_dir.mkdir(parents=True, exist_ok=True)
            (pdf_dir / f"{title}.pdf").write_bytes(b"%PDF-1.4 mock")
            print("PDF conversion complete")
        print(f"{book_id} downloaded successfully")
        sys.exit(0)

    if args[0] == "course":
        url = args[1]
        match = re.search(r"/(\\d{10,13})/?$", url)
        if not match:
            sys.exit(2)
        course_id = match.group(1)
        print("  Loaded cookies from /app/cookies_full.json (4 cookies)")
        print("  Navigating to course page...")
        print("  Found 1 chapters, 1 videos")
        print("--- Phase 2: Getting Kaltura session ---")
        print(f"  Kaltura session token acquired: {CHILD_TOKEN}...")
        print("--- Phase 3: Downloading (videos + transcripts) ---")
        print("  [1/1] Introduction")
        print("    Transcript saved (120 chars)")
        print("    Downloading via ffmpeg...")
        if "--transcripts-only" not in args:
            print("    Downloaded: 0.1 MB")
        print("=== Complete ===")
        print("  Total videos: 1")
        print("  Succeeded: 1")
        print("  Failed: 0")
        course = DOWNLOAD / "courses" / f"course-{course_id}" / "Lesson 1"
        course.mkdir(parents=True, exist_ok=True)
        (course / "Introduction.txt").write_text("hello transcript", encoding="utf-8")
        if "--transcripts-only" not in args:
            (course / "Introduction.mp4").write_bytes(b"mock-video")
        sys.exit(0)

    sys.exit(2)
    """
)


def free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


class WorkerIntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.temporary = tempfile.TemporaryDirectory()
        cls.root = Path(cls.temporary.name)
        cls.config = cls.root / "config"
        cls.data = cls.root / "data"
        cls.download = cls.root / "download"
        cls.app = cls.root / "app"
        for directory in (cls.config, cls.data, cls.download, cls.app):
            directory.mkdir()

        (cls.config / "cookies.json").write_text(
            json.dumps({"sessionid": COOKIE_SECRET}), encoding="utf-8"
        )
        (cls.config / "cookies_full.json").write_text(
            json.dumps({"sessionid": COOKIE_SECRET, "orm-jwt": "jwt-value"}),
            encoding="utf-8",
        )

        cls.mock_cli = cls.root / "mock-cli"
        cls.mock_cli.write_text(MOCK_CLI, encoding="utf-8")
        cls.mock_cli.chmod(0o755)

        cls.port = free_port()
        worker_script = Path(__file__).with_name("worker.py").resolve()
        env = {
            **os.environ,
            "APP_DIR": str(cls.app),
            "WORKER_HOST": "127.0.0.1",
            "WORKER_PORT": str(cls.port),
            "DOWNLOAD_DIR": str(cls.download),
            "CONFIG_DIR": str(cls.config),
            "DATA_DIR": str(cls.data),
            "DOWNLOADER_CLI": str(cls.mock_cli),
            "INTERNAL_API_TOKEN": TOKEN,
            "MAX_CONCURRENT": "1",
            "MOCK_COOKIE_SECRET": COOKIE_SECRET,
            "MOCK_CHILD_TOKEN": CHILD_TOKEN,
            "PYTHONUNBUFFERED": "1",
        }
        cls.process = subprocess.Popen(
            [sys.executable, str(worker_script)],
            env=env,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        deadline = time.time() + 10
        while time.time() < deadline:
            try:
                status, _ = cls.request("GET", "/api/health", token="")
                if status == 200:
                    break
            except OSError:
                pass
            time.sleep(0.1)
        else:
            cls.process.terminate()
            raise RuntimeError("Worker did not become healthy in time.")

    @classmethod
    def tearDownClass(cls) -> None:
        cls.process.terminate()
        try:
            cls.process.wait(timeout=8)
        except subprocess.TimeoutExpired:
            cls.process.kill()
            cls.process.wait(timeout=5)
        cls.temporary.cleanup()

    @classmethod
    def request(
        cls,
        method: str,
        path: str,
        payload: dict | None = None,
        token: str = TOKEN,
        timeout: float = 8,
    ) -> tuple[int, dict]:
        data = None
        headers = {"Accept": "application/json"}
        if token:
            headers["Authorization"] = f"Bearer {token}"
        if payload is not None:
            data = json.dumps(payload).encode()
            headers["Content-Type"] = "application/json"
        request = urllib.request.Request(
            f"http://127.0.0.1:{cls.port}{path}",
            data=data,
            headers=headers,
            method=method,
        )
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                body = response.read().decode()
                return response.status, json.loads(body) if body else {}
        except urllib.error.HTTPError as error:
            try:
                body = error.read().decode()
            finally:
                error.close()
            return error.code, json.loads(body) if body else {}

    def wait_for_job(
        self, job_id: str, statuses: set[str], timeout: float = 20
    ) -> dict:
        deadline = time.time() + timeout
        last = None
        while time.time() < deadline:
            status, payload = self.request("GET", f"/api/jobs/{job_id}")
            self.assertEqual(status, 200, payload)
            last = payload["job"]
            if last["status"] in statuses:
                return last
            time.sleep(0.15)
        self.fail(f"Job {job_id} did not reach {statuses}; last state: {last}")

    def test_health_is_public_and_jobs_require_token(self) -> None:
        status, payload = self.request("GET", "/api/health", token="")
        self.assertEqual(status, 200)
        self.assertEqual(payload["status"], "ok")

        status, _ = self.request("GET", "/api/jobs", token="")
        self.assertEqual(status, 401)
        status, _ = self.request("GET", "/api/jobs", token="wrong-token")
        self.assertEqual(status, 401)

    def test_rejects_invalid_jobs(self) -> None:
        status, payload = self.request(
            "POST",
            "/api/jobs",
            {"type": "course", "courseUrl": "https://example.com/not-a-course"},
        )
        self.assertEqual(status, 400)
        self.assertIn("learning.oreilly.com", payload["error"])

        status, _ = self.request("POST", "/api/jobs", {"type": "book"})
        self.assertEqual(status, 400)

    def test_book_job_completes_and_redacts_secrets(self) -> None:
        status, payload = self.request(
            "POST",
            "/api/jobs",
            {
                "type": "book",
                "bookId": "9780321635754",
                "title": "Integration Book",
                "format": "both",
            },
        )
        self.assertEqual(status, 201, payload)
        job = self.wait_for_job(payload["job"]["id"], {"completed", "failed"})
        self.assertEqual(job["status"], "completed", job)
        self.assertEqual(job["progress"], 100)
        self.assertTrue((self.download / "epub" / "Integration Book.epub").is_file())
        self.assertTrue((self.download / "pdf" / "Integration Book.pdf").is_file())

        logs = "\n".join(job["logs"])
        self.assertNotIn(COOKIE_SECRET, logs)
        self.assertIn("[redacted]", logs)

    def test_course_job_completes_and_redacts_kaltura_token(self) -> None:
        status, payload = self.request(
            "POST",
            "/api/jobs",
            {
                "type": "course",
                "courseUrl": "https://learning.oreilly.com/course/mock-course/0642572077884/",
                "label": "Mock Course",
            },
        )
        self.assertEqual(status, 201, payload)
        job = self.wait_for_job(payload["job"]["id"], {"completed", "failed"})
        self.assertEqual(job["status"], "completed", job)
        self.assertEqual(job["progress"], 100)
        course = self.download / "courses" / "course-0642572077884"
        self.assertTrue((course / "Lesson 1" / "Introduction.mp4").is_file())
        self.assertTrue((course / "Lesson 1" / "Introduction.txt").is_file())

        logs = "\n".join(job["logs"])
        self.assertNotIn(CHILD_TOKEN, logs)
        self.assertNotIn(COOKIE_SECRET, logs)
        self.assertIn("[redacted]", logs)

    def test_queued_job_can_be_cancelled(self) -> None:
        status, payload = self.request(
            "POST",
            "/api/jobs",
            {
                "type": "book",
                "bookId": "9780321635754",
                "title": "Cancel Me",
                "format": "epub",
            },
        )
        self.assertEqual(status, 201, payload)
        job_id = payload["job"]["id"]
        self.wait_for_job(job_id, {"running"})
        status, payload = self.request("POST", f"/api/jobs/{job_id}/cancel")
        self.assertEqual(status, 200, payload)
        job = self.wait_for_job(job_id, {"cancelled", "failed"}, timeout=20)
        self.assertEqual(job["status"], "cancelled", job)


if __name__ == "__main__":
    unittest.main()
