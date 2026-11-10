#!/usr/bin/env python3
"""
Shelf downloader worker
=======================

A deliberately small adapter around the existing O'Reilly downloader CLI.
It does **not** implement any download logic itself. Instead it runs
``docker-entrypoint.sh book|course`` exactly as the upstream project expects,
tracks the process, parses its human-readable progress output, redacts
credentials, and exposes an internal, token-protected HTTP API for the web
container.

The API is never published outside the Docker Compose network.
"""

from __future__ import annotations

import hmac
import json
import os
import re
import signal
import sys
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from queue import Empty, Queue
from subprocess import PIPE, Popen
from typing import Any
from urllib.parse import urlsplit, urlunparse

VERSION = "1.0.0"

APP_DIR = Path(os.environ.get("APP_DIR", "/app"))
DOWNLOAD_DIR = Path(os.environ.get("DOWNLOAD_DIR", str(APP_DIR / "download")))
CONFIG_DIR = Path(os.environ.get("CONFIG_DIR", "/config"))
DATA_DIR = Path(os.environ.get("DATA_DIR", "/data"))
JOBS_DIR = DATA_DIR / "jobs"
CLI = os.environ.get("DOWNLOADER_CLI", str(APP_DIR / "docker-entrypoint.sh"))
HOST = os.environ.get("WORKER_HOST", "0.0.0.0")
PORT = int(os.environ.get("WORKER_PORT", "8081"))
MAX_CONCURRENT = max(1, min(4, int(os.environ.get("MAX_CONCURRENT", "1"))))
INTERNAL_TOKEN = os.environ.get("INTERNAL_API_TOKEN", "")
MAX_LOG_BYTES = 2 * 1024 * 1024
LOG_TAIL_BYTES = 512 * 1024
MAX_HTTP_BODY = 128 * 1024

ANSI_RE = re.compile(r"\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])")
CONTROL_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
JOB_ID_RE = re.compile(r"^[a-f0-9]{6,32}$")
COURSE_ID_RE = re.compile(r"/(\d{10,13})$")
BOOK_ID_RE = re.compile(r"^\d{10,13}$")
UNSAFE_TITLE_RE = re.compile(r"[/\\\x00-\x1f\x7f*?\[\]]")
UNSAFE_AGING_RE = re.compile(r"[\x00-\x1f\x7f]")

TOKEN_REDACTIONS = [
    (re.compile(r"(?i)(kaltura session token acquired:\s*)\S+"), r"\1[redacted]"),
    (re.compile(r"(?i)(\b(?:ks|token|jwt|sessionid|session|authorization|bearer|cookie)\b\s*[:=]\s*)([^\s,;]+)"), r"\1[redacted]"),
    (re.compile(r"(/ks/)[^/\s]+"), r"\1[redacted]"),
    (re.compile(r"([?&]ks=)[^&\s]+"), r"\1[redacted]"),
]


class ValidationError(Exception):
    """A user-facing input error."""


def iso_now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def is_iso(value: Any) -> bool:
    return isinstance(value, str) and bool(value)


def log(message: str) -> None:
    print(f"[worker] {message}", flush=True)


# ---------------------------------------------------------------------------
# Credential handling & log redaction
# ---------------------------------------------------------------------------


def ensure_cookie_links() -> None:
    """Expose the shared /config cookie files at the paths the CLI expects.

    The upstream scripts hard-code /app/cookies.json, /app/data/cookies.json
    and /app/cookies_full.json. Symlinks keep the original scripts untouched
    while making the host-managed /config folder the single source of truth.
    """
    (APP_DIR / "data").mkdir(parents=True, exist_ok=True)
    links = [
        (CONFIG_DIR / "cookies.json", APP_DIR / "cookies.json"),
        (CONFIG_DIR / "cookies.json", APP_DIR / "data" / "cookies.json"),
        (CONFIG_DIR / "cookies_full.json", APP_DIR / "cookies_full.json"),
        (CONFIG_DIR / "cookies_full.json", APP_DIR / "data" / "cookies_full.json"),
    ]
    for source, destination in links:
        try:
            destination.parent.mkdir(parents=True, exist_ok=True)
            if destination.is_symlink():
                if destination.resolve(strict=False) == source.resolve(strict=False):
                    continue
                destination.unlink()
            if not destination.exists():
                destination.symlink_to(source)
        except OSError as exc:
            log(f"Could not link {destination} -> {source}: {exc.strerror or exc}")


def read_cookie_status() -> dict[str, dict[str, Any]]:
    """Return safe metadata for the two cookie files. Never returns values."""
    result: dict[str, dict[str, Any]] = {}
    definitions = {
        "book": ("cookies.json", "Book downloads"),
        "course": ("cookies_full.json", "Video courses"),
    }
    for kind, (filename, required_for) in definitions.items():
        path = CONFIG_DIR / filename
        status: dict[str, Any] = {
            "kind": kind,
            "fileName": filename,
            "requiredFor": required_for,
            "configured": path.is_file(),
            "valid": False,
            "cookieCount": 0,
            "sizeBytes": 0,
            "modifiedAt": None,
            "error": None,
        }
        if not path.is_file():
            result[kind] = status
            continue
        try:
            stat = path.stat()
            status["sizeBytes"] = stat.st_size
            status["modifiedAt"] = time.strftime(
                "%Y-%m-%dT%H:%M:%SZ", time.gmtime(stat.st_mtime)
            )
            if stat.st_size > 1024 * 1024:
                status["error"] = "Cookie file is unexpectedly large."
                result[kind] = status
                continue
            with path.open("r", encoding="utf-8") as handle:
                payload = json.load(handle)
            if not isinstance(payload, dict) or not payload:
                status["error"] = "Expected a non-empty JSON object."
                result[kind] = status
                continue
            if not all(isinstance(k, str) and isinstance(v, str) for k, v in payload.items()):
                status["error"] = "Cookie values must all be strings."
                result[kind] = status
                continue
            status["valid"] = True
            status["cookieCount"] = len(payload)
        except (OSError, ValueError, UnicodeError):
            status["error"] = "File is not valid JSON."
        result[kind] = status
    return result


def collect_secret_values() -> list[str]:
    """Load cookie values for in-memory redaction only."""
    values: set[str] = set()
    for filename in ("cookies.json", "cookies_full.json"):
        path = CONFIG_DIR / filename
        try:
            with path.open("r", encoding="utf-8") as handle:
                payload = json.load(handle)
            if isinstance(payload, dict):
                for value in payload.values():
                    if isinstance(value, str) and len(value) >= 6:
                        values.add(value)
        except (OSError, ValueError, UnicodeError):
            continue
    # Longest first so overlapping values are fully removed.
    return sorted(values, key=len, reverse=True)


def sanitize_log_line(raw: str, secrets: list[str]) -> str:
    line = ANSI_RE.sub("", raw)
    line = line.replace("\r", "")
    for secret in secrets:
        line = line.replace(secret, "[redacted]")
    for pattern, replacement in TOKEN_REDACTIONS:
        line = pattern.sub(replacement, line)
    line = CONTROL_RE.sub("", line)
    if len(line) > 4000:
        line = line[:4000] + " …"
    return line.rstrip()


def cookie_age_warning(kind: str) -> str | None:
    filename = "cookies_full.json" if kind == "course" else "cookies.json"
    path = CONFIG_DIR / filename
    try:
        age_days = (time.time() - path.stat().st_mtime) / 86400
    except OSError:
        return None
    if age_days >= 30:
        return (
            f"Cookies were last updated {int(age_days)} days ago. "
            "Refresh them if the download fails to authenticate."
        )
    return None


def preflight_cookies(kind: str) -> str | None:
    filename = "cookies_full.json" if kind == "course" else "cookies.json"
    path = CONFIG_DIR / filename
    if not path.is_file():
        return (
            f"Missing {filename}. Add it in Settings before starting this download."
        )
    try:
        if path.stat().st_size > 1024 * 1024:
            return f"{filename} is unexpectedly large and was not used."
        with path.open("r", encoding="utf-8") as handle:
            payload = json.load(handle)
    except (OSError, ValueError, UnicodeError):
        return f"{filename} is not valid JSON. Update it in Settings."
    if not isinstance(payload, dict) or not payload:
        return f"{filename} must contain a non-empty JSON object."
    if not all(isinstance(k, str) and isinstance(v, str) for k, v in payload.items()):
        return f"{filename} contains values that are not strings."
    return None


# ---------------------------------------------------------------------------
# Input validation
# ---------------------------------------------------------------------------


def clean_title(value: Any) -> str:
    title = re.sub(r"\s+", " ", str(value or "")).strip()
    if not title:
        raise ValidationError("A title is required so the file can be identified later.")
    if len(title) > 100:
        raise ValidationError("Titles must be 100 characters or fewer.")
    if title.startswith((".", "-")):
        raise ValidationError("Titles cannot start with a dot or a hyphen.")
    if UNSAFE_TITLE_RE.search(title):
        raise ValidationError(
            "Titles cannot contain slashes, control characters, or * ? [ ]."
        )
    return title


def validate_payload(payload: Any) -> tuple[dict[str, Any], str, str]:
    """Return (input, display_title, subtitle)."""
    if not isinstance(payload, dict):
        raise ValidationError("Expected a JSON object.")

    kind = payload.get("type")
    if kind == "book":
        book_id = re.sub(r"\s+", "", str(payload.get("bookId") or ""))
        if not BOOK_ID_RE.fullmatch(book_id):
            raise ValidationError("Enter a book ID containing 10 to 13 digits.")
        title = clean_title(payload.get("title") or book_id)
        fmt = str(payload.get("format") or "both").lower()
        if fmt not in {"epub", "pdf", "both"}:
            raise ValidationError("Format must be epub, pdf, or both.")
        request = {
            "type": "book",
            "bookId": book_id,
            "title": title,
            "format": fmt,
        }
        return request, title, f"Book · {book_id}"

    if kind == "course":
        raw_url = str(payload.get("courseUrl") or "").strip()
        if not raw_url:
            raise ValidationError("A course URL is required.")
        try:
            parsed = urlsplit(raw_url)
            port = parsed.port
        except ValueError as exc:
            raise ValidationError("That course URL is not valid.") from exc
        if (
            parsed.scheme != "https"
            or (parsed.hostname or "").lower() != "learning.oreilly.com"
            or port not in (None, 443)
            or parsed.username
            or parsed.password
        ):
            raise ValidationError(
                "Use a full https://learning.oreilly.com/course/… URL."
            )
        path = parsed.path.rstrip("/")
        match = COURSE_ID_RE.search(path)
        if "/course/" not in path or not match:
            raise ValidationError(
                "The URL should point at a course and end with its 10–13 digit ID."
            )
        course_id = match.group(1)
        canonical_url = urlunparse(
            ("https", "learning.oreilly.com", path + "/", "", "", "")
        )
        label = re.sub(r"\s+", " ", str(payload.get("label") or "")).strip()
        if len(label) > 120:
            raise ValidationError("The course label must be 120 characters or fewer.")
        if label and UNSAFE_AGING_RE.search(label):
            raise ValidationError("The course label contains control characters.")
        request = {
            "type": "course",
            "courseUrl": canonical_url,
            "courseId": course_id,
            "label": label or None,
            "transcriptsOnly": payload.get("transcriptsOnly") is True,
        }
        title = label or f"Course {course_id}"
        return request, title, f"Video course · {course_id}"

    raise ValidationError("Unknown download type.")


# ---------------------------------------------------------------------------
# Progress parsing
# ---------------------------------------------------------------------------

BOOK_RULES = [
    (re.compile(r"using cookies from", re.I), 4, "Preparing"),
    (re.compile(r"successfully authenticated", re.I), 10, "Authenticated"),
    (re.compile(r"retrieving book info", re.I), 15, "Fetching book details"),
    (re.compile(r"retrieving book chapters", re.I), 22, "Fetching chapters"),
    (re.compile(r"downloading book contents", re.I), 30, "Downloading content"),
    (re.compile(r"downloading book css", re.I), 64, "Downloading styles"),
    (re.compile(r"downloading book images", re.I), 74, "Downloading images"),
    (re.compile(r"creating epub", re.I), 88, "Building EPUB"),
    (re.compile(r"^done:", re.I), 94, "EPUB ready"),
    (re.compile(r"converting to pdf", re.I), 95, "Converting to PDF"),
    (re.compile(r"pdf conversion complete", re.I), 99, "Finalising"),
    (re.compile(r"downloaded successfully", re.I), 99, "Finishing"),
]


class JobManager:
    def __init__(self) -> None:
        self.lock = threading.RLock()
        self.jobs: dict[str, dict[str, Any]] = {}
        self.queue: Queue[str | None] = Queue()
        self.stop_event = threading.Event()
        self.threads: list[threading.Thread] = []
        JOBS_DIR.mkdir(parents=True, exist_ok=True)
        self._load_jobs()
        for index in range(MAX_CONCURRENT):
            thread = threading.Thread(
                target=self._worker_loop,
                name=f"download-{index + 1}",
                daemon=True,
            )
            thread.start()
            self.threads.append(thread)

    # -- persistence ------------------------------------------------------

    def _job_file(self, job_id: str) -> Path:
        return JOBS_DIR / f"{job_id}.json"

    def _log_file(self, job_id: str) -> Path:
        return JOBS_DIR / f"{job_id}.log"

    @staticmethod
    def _meta(job: dict[str, Any]) -> dict[str, Any]:
        return {key: value for key, value in job.items() if not key.startswith("_")}

    def _save(self, job: dict[str, Any]) -> None:
        job["updatedAt"] = iso_now()
        path = self._job_file(job["id"])
        temp = path.with_suffix(".json.tmp")
        try:
            with temp.open("w", encoding="utf-8") as handle:
                json.dump(self._meta(job), handle, ensure_ascii=False, indent=2)
            os.replace(temp, path)
        except OSError as exc:
            log(f"Could not persist job {job['id']}: {exc.strerror or exc}")
            try:
                temp.unlink(missing_ok=True)
            except OSError:
                pass

    def _load_jobs(self) -> None:
        interrupted = False
        try:
            files = sorted(JOBS_DIR.glob("*.json"))
        except OSError:
            files = []
        for path in files:
            try:
                with path.open("r", encoding="utf-8") as handle:
                    job = json.load(handle)
                if not isinstance(job, dict) or not JOB_ID_RE.fullmatch(str(job.get("id", ""))):
                    continue
            except (OSError, ValueError, UnicodeError):
                continue
            job.setdefault("progress", 0)
            job.setdefault("stage", "Queued")
            job.setdefault("error", None)
            job.setdefault("warning", None)
            job.setdefault("startedAt", None)
            job.setdefault("finishedAt", None)
            job["_process"] = None
            job["_cancelRequested"] = False
            job["_warnings"] = []
            status = job.get("status")
            if status in {"running", "cancelling"}:
                job["status"] = "failed"
                job["stage"] = "Interrupted"
                job["error"] = "The downloader restarted before this job finished."
                job["finishedAt"] = iso_now()
                interrupted = True
            elif status == "queued":
                interrupted = True
            self.jobs[job["id"]] = job
            if status == "queued":
                self.queue.put(job["id"])
            if interrupted:
                self._save(job)
            self._append_log(
                job, "[shelf] Restored job after downloader restart." if status == "queued" else ""
            )
            interrupted = False

    def _append_log(self, job: dict[str, Any], line: str) -> None:
        if not line:
            return
        try:
            path = self._log_file(job["id"])
            if path.exists() and path.stat().st_size > MAX_LOG_BYTES:
                with path.open("rb") as handle:
                    handle.seek(-LOG_TAIL_BYTES, os.SEEK_END)
                    tail = handle.read()
                with path.open("wb") as handle:
                    handle.write(b"[shelf] Earlier log output was truncated.\n")
                    handle.write(tail)
            with path.open("a", encoding="utf-8") as handle:
                handle.write(line + "\n")
        except OSError as exc:
            log(f"Could not write log for {job['id']}: {exc.strerror or exc}")

    # -- public views -----------------------------------------------------

    def _public(self, job: dict[str, Any]) -> dict[str, Any]:
        data = self._meta(job)
        data["logAvailable"] = self._log_file(job["id"]).is_file()
        return data

    def list_jobs(self) -> list[dict[str, Any]]:
        with self.lock:
            jobs = [self._public(job) for job in self.jobs.values()]
        jobs.sort(key=lambda item: item.get("createdAt") or "", reverse=True)
        return jobs

    def get_job(self, job_id: str, tail_lines: int = 1500) -> dict[str, Any] | None:
        with self.lock:
            job = self.jobs.get(job_id)
            if not job:
                return None
            data = self._public(job)
        lines, truncated = tail_log(self._log_file(job_id), tail_lines)
        data["logs"] = lines
        data["logTruncated"] = truncated
        return data

    def health(self) -> dict[str, Any]:
        with self.lock:
            active = sum(
                1 for job in self.jobs.values() if job.get("status") == "running"
            )
            queued = sum(
                1 for job in self.jobs.values() if job.get("status") == "queued"
            )
            total = len(self.jobs)
        return {
            "status": "ok",
            "version": VERSION,
            "active": active,
            "queued": queued,
            "totalJobs": total,
            "maxConcurrent": MAX_CONCURRENT,
        }

    # -- commands ---------------------------------------------------------

    def create_job(self, payload: Any) -> dict[str, Any]:
        request, title, subtitle = validate_payload(payload)
        job: dict[str, Any] = {
            "id": uuid.uuid4().hex[:12],
            "type": request["type"],
            "title": title,
            "subtitle": subtitle,
            "input": request,
            "status": "queued",
            "progress": 0,
            "stage": "Queued",
            "error": None,
            "warning": None,
            "createdAt": iso_now(),
            "updatedAt": iso_now(),
            "startedAt": None,
            "finishedAt": None,
            "_process": None,
            "_cancelRequested": False,
            "_warnings": [],
        }
        with self.lock:
            self.jobs[job["id"]] = job
            self._save(job)
        self.queue.put(job["id"])
        log(f"Job {job['id']} queued ({job['type']}, {title})")
        return self._public(job)

    def cancel_job(self, job_id: str) -> dict[str, Any] | None:
        with self.lock:
            job = self.jobs.get(job_id)
            if not job:
                return None
            status = job.get("status")
            if status in {"completed", "failed", "cancelled"}:
                return self._public(job)
            job["_cancelRequested"] = True
            if status == "queued":
                job["status"] = "cancelled"
                job["stage"] = "Cancelled"
                job["finishedAt"] = iso_now()
                self._save(job)
                self._append_log(job, "[shelf] Job cancelled before it started.")
                return self._public(job)
            job["status"] = "cancelling"
            job["stage"] = "Cancelling"
            self._save(job)
            process = job.get("_process")
        self._append_log(job, "[shelf] Cancellation requested.")
        if process is not None:
            terminate_process(job, process)
        return self._public(job)

    def shutdown(self) -> None:
        self.stop_event.set()
        with self.lock:
            running = [
                (job, job.get("_process"))
                for job in self.jobs.values()
                if job.get("_process") is not None
            ]
        for job, process in running:
            if process is not None:
                job["_cancelRequested"] = True
                terminate_process(job, process)
        for _ in self.threads:
            self.queue.put(None)

    # -- queue loop -------------------------------------------------------

    def _worker_loop(self) -> None:
        while not self.stop_event.is_set():
            try:
                job_id = self.queue.get(timeout=0.5)
            except Empty:
                continue
            if job_id is None:
                break
            with self.lock:
                job = self.jobs.get(job_id)
                if not job or job.get("status") != "queued":
                    continue
                if job.get("_cancelRequested"):
                    job["status"] = "cancelled"
                    job["stage"] = "Cancelled"
                    job["finishedAt"] = iso_now()
                    self._save(job)
                    continue
            try:
                self._run_job(job)
            except Exception as exc:  # pragma: no cover - defensive boundary
                log(f"Unexpected failure for job {job_id}: {type(exc).__name__}")
                with self.lock:
                    if job.get("status") not in {"completed", "cancelled"}:
                        job["status"] = "failed"
                        job["stage"] = "Failed"
                        job["error"] = "The download runner hit an unexpected error."
                        job["finishedAt"] = iso_now()
                        self._save(job)
                        self._append_log(job, f"[shelf] Internal error: {type(exc).__name__}")

    # -- job execution ----------------------------------------------------

    def _run_job(self, job: dict[str, Any]) -> None:
        job_id = job["id"]
        preflight_error = preflight_cookies(job["type"])
        if preflight_error:
            with self.lock:
                job["status"] = "failed"
                job["stage"] = "Authentication required"
                job["error"] = preflight_error
                job["finishedAt"] = iso_now()
                self._save(job)
                self._append_log(job, f"[shelf] {preflight_error}")
            return

        secrets = collect_secret_values()
        age_warning = cookie_age_warning(job["type"])
        with self.lock:
            job["status"] = "running"
            job["progress"] = 1
            job["stage"] = "Starting"
            job["startedAt"] = iso_now()
            if age_warning:
                job["_warnings"].append(age_warning)
                job["warning"] = age_warning
            self._save(job)

        request = job["input"]
        if job["type"] == "book":
            command = [
                CLI,
                "book",
                "-b",
                request["bookId"],
                "-t",
                request["title"],
                "-f",
                request["format"],
            ]
        else:
            command = [CLI, "course", request["courseUrl"]]
            if request.get("transcriptsOnly"):
                command.append("--transcripts-only")

        self._append_log(job, f"[shelf] Started {job['type']} download at {iso_now()}.")
        env = os.environ.copy()
        env["PYTHONUNBUFFERED"] = "1"
        env["CHROME_PATH"] = env.get("CHROME_PATH", "/usr/bin/chromium")
        env.setdefault("HOME", "/tmp")

        process: Popen[str] | None = None
        recent_lines: list[str] = []
        try:
            process = Popen(
                command,
                cwd=str(APP_DIR),
                env=env,
                stdout=PIPE,
                stderr=__import__("subprocess").STDOUT,
                text=True,
                encoding="utf-8",
                errors="replace",
                bufsize=1,
                start_new_session=True,
            )
            with self.lock:
                job["_process"] = process
                cancel_requested = job.get("_cancelRequested", False)
            if cancel_requested:
                terminate_process(job, process)

            assert process.stdout is not None
            for raw_line in process.stdout:
                line = sanitize_log_line(raw_line, secrets)
                if not line:
                    continue
                self._append_log(job, line)
                print(line, flush=True)
                recent_lines.append(line)
                if len(recent_lines) > 40:
                    recent_lines.pop(0)
                self._parse_progress(job, line)

            return_code = process.wait()
        except FileNotFoundError:
            with self.lock:
                job["status"] = "failed"
                job["stage"] = "Failed"
                job["error"] = "The downloader CLI was not found inside the container."
                job["finishedAt"] = iso_now()
                self._save(job)
            return
        except Exception as exc:
            with self.lock:
                job["status"] = "failed"
                job["stage"] = "Failed"
                job["error"] = "The downloader process could not be started."
                job["finishedAt"] = iso_now()
                self._save(job)
                self._append_log(job, f"[shelf] Process error: {type(exc).__name__}")
            return
        finally:
            with self.lock:
                job["_process"] = None

        with self.lock:
            cancelled = job.get("_cancelRequested") or job.get("status") == "cancelling"
            if cancelled:
                job["status"] = "cancelled"
                job["stage"] = "Cancelled"
                job["finishedAt"] = iso_now()
                self._save(job)
                self._append_log(job, "[shelf] Job cancelled.")
                return

        if return_code != 0:
            error = extract_error(recent_lines, return_code)
            with self.lock:
                job["status"] = "failed"
                job["stage"] = "Failed"
                job["error"] = error
                job["finishedAt"] = iso_now()
                self._save(job)
                self._append_log(job, f"[shelf] Job failed: {error}")
            return

        verification_error, warnings = verify_outputs(job)
        with self.lock:
            all_warnings = list(dict.fromkeys(job["_warnings"] + warnings))
            if all_warnings:
                job["warning"] = " · ".join(all_warnings)[:700]
            if verification_error:
                job["status"] = "failed"
                job["stage"] = "Failed"
                job["error"] = verification_error
                job["finishedAt"] = iso_now()
                self._save(job)
                self._append_log(job, f"[shelf] {verification_error}")
                return
            job["status"] = "completed"
            job["progress"] = 100
            job["stage"] = "Completed"
            job["finishedAt"] = iso_now()
            job["error"] = None
            self._save(job)
            self._append_log(job, "[shelf] Job completed successfully.")

    def _parse_progress(self, job: dict[str, Any], line: str) -> None:
        progress = int(job.get("progress") or 0)
        stage = job.get("stage") or "Working"
        new_progress = progress
        new_stage = stage

        if job["type"] == "book":
            for pattern, pct, label in BOOK_RULES:
                if pattern.search(line) and pct > new_progress:
                    new_progress = pct
                    new_stage = label
                    break
            failed_pdf = re.search(r"warning:\s*pdf conversion failed", line, re.I)
            if failed_pdf:
                self._add_warning(job, "PDF conversion failed; the EPUB was still saved.")
        else:
            if re.search(r"navigating to course page", line, re.I) and new_progress < 5:
                new_progress, new_stage = 5, "Opening course"
            found = re.search(r"found\s+(\d+)\s+chapters?,\s*(\d+)\s+videos?", line, re.I)
            if found and new_progress < 12:
                new_progress, new_stage = 12, "Course structure found"
            if re.search(r"phase 2", line, re.I) and new_progress < 15:
                new_progress, new_stage = 15, "Authenticating"
            if re.search(r"kaltura session token acquired", line, re.I) and new_progress < 18:
                new_progress, new_stage = 18, "Session ready"
            if re.search(r"phase 3", line, re.I) and new_progress < 20:
                new_progress, new_stage = 20, "Downloading lessons"
            lesson = re.search(r"\[(\d+)\s*/\s*(\d+)\]", line)
            if lesson:
                current, total = int(lesson.group(1)), int(lesson.group(2))
                if total > 0:
                    pct = min(98, 20 + int(78 * current / total))
                    if pct > new_progress:
                        new_progress = pct
                    new_stage = f"Lesson {current} of {total}"
            if re.search(r"=== complete ===", line) and new_progress < 99:
                new_progress, new_stage = 99, "Finalising"
            summary = re.search(r"failed:\s*(\d+)", line, re.I)
            if summary and int(summary.group(1)) > 0:
                self._add_warning(
                    job,
                    f"{summary.group(1)} lesson(s) could not be downloaded. "
                    "The job can be retried to resume.",
                )

        if new_progress != progress or new_stage != stage:
            with self.lock:
                job["progress"] = new_progress
                job["stage"] = new_stage
                self._save(job)

    def _add_warning(self, job: dict[str, Any], warning: str) -> None:
        with self.lock:
            if warning not in job["_warnings"]:
                job["_warnings"].append(warning)
                job["warning"] = " · ".join(job["_warnings"])[:700]
                self._save(job)


# ---------------------------------------------------------------------------
# Output verification, log tailing, process control
# ---------------------------------------------------------------------------


def tail_log(path: Path, max_lines: int = 1500) -> tuple[list[str], bool]:
    max_lines = max(1, min(max_lines, 5000))
    try:
        with path.open("rb") as handle:
            handle.seek(0, os.SEEK_END)
            size = handle.tell()
            start = max(0, size - LOG_TAIL_BYTES)
            handle.seek(start)
            data = handle.read()
    except OSError:
        return [], False
    text = data.decode("utf-8", "replace")
    lines = text.splitlines()
    truncated = start > 0
    if len(lines) > max_lines:
        lines = lines[-max_lines:]
        truncated = True
    return lines, truncated


def extract_error(lines: list[str], return_code: int) -> str:
    useful = re.compile(
        r"(?i)(error|failed|unable|not found|authentication issue|expired|invalid|aborting)"
    )
    for line in reversed(lines):
        candidate = line.strip()
        if not candidate or candidate.lower().startswith("[shelf]"):
            continue
        if re.search(r"failed:\s*0\b", candidate, re.I):
            continue
        if useful.search(candidate):
            return candidate[:600]
    return f"The downloader exited with code {return_code}."


def verify_outputs(job: dict[str, Any]) -> tuple[str | None, list[str]]:
    warnings: list[str] = []
    if job["type"] == "book":
        title = job["input"]["title"]
        fmt = job["input"]["format"]
        epub_path = DOWNLOAD_DIR / "epub" / f"{title}.epub"
        pdf_path = DOWNLOAD_DIR / "pdf" / f"{title}.pdf"
        epub_ok = epub_path.is_file() and epub_path.stat().st_size > 0
        pdf_ok = pdf_path.is_file() and pdf_path.stat().st_size > 0
        if fmt in {"epub", "both"} and not epub_ok:
            return "The downloader finished but no valid EPUB was found.", warnings
        if fmt in {"pdf", "both"} and not pdf_ok:
            if fmt == "pdf":
                return "The downloader finished but no PDF was found.", warnings
            warnings.append("PDF conversion failed; the EPUB was still saved.")
        return None, warnings

    course_dir = DOWNLOAD_DIR / "courses" / f"course-{job['input']['courseId']}"
    try:
        files = [path for path in course_dir.rglob("*") if path.is_file()]
    except OSError:
        files = []
    if not files or not any(path.stat().st_size > 0 for path in files):
        return "The downloader finished but no course files were found.", warnings
    if job["input"].get("transcriptsOnly") and not any(
        path.suffix.lower() in {".txt", ".vtt", ".srt"} for path in files
    ):
        return "No transcripts were produced for this course.", warnings
    return None, warnings


def terminate_process(job: dict[str, Any], process: Popen[str]) -> None:
    try:
        if process.poll() is not None:
            return
        os.killpg(os.getpgid(process.pid), signal.SIGTERM)
    except (OSError, ProcessLookupError):
        return

    pid = process.pid

    def force_kill() -> None:
        time.sleep(8)
        try:
            if process.poll() is None:
                os.killpg(os.getpgid(pid), signal.SIGKILL)
        except (OSError, ProcessLookupError):
            pass

    threading.Thread(target=force_kill, daemon=True).start()


# ---------------------------------------------------------------------------
# Internal HTTP API
# ---------------------------------------------------------------------------


class Handler(BaseHTTPRequestHandler):
    server_version = f"ShelfWorker/{VERSION}"
    protocol_version = "HTTP/1.1"
    manager: JobManager

    def log_message(self, fmt: str, *args: Any) -> None:  # noqa: A003
        # Keep container logs free of request noise and query strings.
        return

    def _authorized(self) -> bool:
        if not INTERNAL_TOKEN:
            return True
        header = self.headers.get("Authorization", "")
        return hmac.compare_digest(header, f"Bearer {INTERNAL_TOKEN}")

    def _send_json(self, status: int, payload: dict[str, Any]) -> None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(data)

    def _error(self, status: int, message: str) -> None:
        self._send_json(status, {"error": message})

    def _read_json(self) -> Any:
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError as exc:
            raise ValidationError("Invalid Content-Length.") from exc
        if length <= 0 or length > MAX_HTTP_BODY:
            raise ValidationError("Request body is missing or too large.")
        raw = self.rfile.read(length)
        try:
            return json.loads(raw.decode("utf-8"))
        except (ValueError, UnicodeError) as exc:
            raise ValidationError("Request body must be valid JSON.") from exc

    def _handle_api_error(self, exc: Exception) -> None:
        if isinstance(exc, ValidationError):
            self._error(400, str(exc))
            return
        log(f"API request failed: {type(exc).__name__}")
        self._error(500, "Internal worker error.")

    def do_GET(self) -> None:  # noqa: N802
        path = urlsplit(self.path).path
        try:
            if path == "/api/health":
                self._send_json(200, self.manager.health())
                return
            if not self._authorized():
                self._error(401, "Unauthorized.")
                return
            if path == "/api/jobs":
                self._send_json(200, {"jobs": self.manager.list_jobs()})
                return
            match = re.fullmatch(r"/api/jobs/([a-f0-9]{6,32})", path)
            if match:
                raw_tail = urlsplit(self.path).query
                tail_lines = 1500
                for part in raw_tail.split("&"):
                    if part.startswith("tail="):
                        try:
                            tail_lines = int(part[5:])
                        except ValueError:
                            pass
                job = self.manager.get_job(match.group(1), tail_lines)
                if not job:
                    self._error(404, "Job not found.")
                    return
                self._send_json(200, {"job": job})
                return
            self._error(404, "Not found.")
        except Exception as exc:  # noqa: BLE001
            self._handle_api_error(exc)

    def do_POST(self) -> None:  # noqa: N802
        path = urlsplit(self.path).path
        try:
            if not self._authorized():
                self._error(401, "Unauthorized.")
                return
            if path == "/api/jobs":
                payload = self._read_json()
                job = self.manager.create_job(payload)
                self._send_json(201, {"job": job})
                return
            match = re.fullmatch(r"/api/jobs/([a-f0-9]{6,32})/cancel", path)
            if match:
                job = self.manager.cancel_job(match.group(1))
                if not job:
                    self._error(404, "Job not found.")
                    return
                self._send_json(200, {"job": job})
                return
            self._error(404, "Not found.")
        except Exception as exc:  # noqa: BLE001
            self._handle_api_error(exc)

    def do_HEAD(self) -> None:  # noqa: N802
        self.do_GET()


class ThreadingServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def main() -> int:
    ensure_cookie_links()
    manager = JobManager()
    Handler.manager = manager
    server = ThreadingServer((HOST, PORT), Handler)

    def handle_signal(signum: int, _frame: Any) -> None:
        log(f"Received signal {signum}; shutting down.")
        manager.shutdown()
        threading.Thread(target=server.shutdown, daemon=True).start()

    signal.signal(signal.SIGTERM, handle_signal)
    signal.signal(signal.SIGINT, handle_signal)

    log(f"Shelf worker {VERSION} listening on {HOST}:{PORT} (concurrency={MAX_CONCURRENT})")
    log("Internal API only; do not publish this port outside the Compose network.")
    try:
        server.serve_forever(poll_interval=0.5)
    finally:
        manager.shutdown()
        server.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
