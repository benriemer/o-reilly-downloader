"""Unit tests for the downloader worker adapter."""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

import worker


class ValidationTests(unittest.TestCase):
    def test_book_payload(self) -> None:
        request, title, subtitle = worker.validate_payload(
            {
                "type": "book",
                "bookId": " 9780321635754 ",
                "title": "  The   Art of Computer Programming ",
                "format": "BOTH",
            }
        )
        self.assertEqual(request["type"], "book")
        self.assertEqual(request["bookId"], "9780321635754")
        self.assertEqual(request["title"], "The Art of Computer Programming")
        self.assertEqual(request["format"], "both")
        self.assertEqual(title, "The Art of Computer Programming")
        self.assertIn("9780321635754", subtitle)

    def test_book_defaults_title_to_id(self) -> None:
        request, title, _ = worker.validate_payload(
            {"type": "book", "bookId": "9780321635754"}
        )
        self.assertEqual(request["title"], "9780321635754")
        self.assertEqual(request["format"], "both")
        self.assertEqual(title, "9780321635754")

    def test_invalid_book_inputs(self) -> None:
        bad_payloads = [
            {"type": "book", "bookId": "123"},
            {"type": "book", "bookId": "abcdefghij"},
            {"type": "book", "bookId": "9780321635754", "format": "mobi"},
            {"type": "book", "bookId": "9780321635754", "title": "a/b"},
            {"type": "book", "bookId": "9780321635754", "title": ".hidden"},
            {"type": "book", "bookId": "9780321635754", "title": "x" * 101},
            {"type": "book", "bookId": "9780321635754", "title": "bad\x00title"},
        ]
        for payload in bad_payloads:
            with self.subTest(payload=payload):
                with self.assertRaises(worker.ValidationError):
                    worker.validate_payload(payload)

    def test_course_payload(self) -> None:
        request, title, _ = worker.validate_payload(
            {
                "type": "course",
                "courseUrl": "https://learning.oreilly.com/course/building-ai-agents/0642572077884/",
                "label": "Building AI Agents",
                "transcriptsOnly": True,
            }
        )
        self.assertEqual(
            request["courseUrl"],
            "https://learning.oreilly.com/course/building-ai-agents/0642572077884/",
        )
        self.assertEqual(request["courseId"], "0642572077884")
        self.assertEqual(request["label"], "Building AI Agents")
        self.assertIs(request["transcriptsOnly"], True)
        self.assertEqual(title, "Building AI Agents")

    def test_course_url_is_canonicalised(self) -> None:
        request, title, _ = worker.validate_payload(
            {
                "type": "course",
                "courseUrl": "https://learning.oreilly.com/course/topic/0642572077884?x=1#frag",
            }
        )
        self.assertEqual(
            request["courseUrl"],
            "https://learning.oreilly.com/course/topic/0642572077884/",
        )
        self.assertEqual(title, "Course 0642572077884")

    def test_invalid_course_urls(self) -> None:
        bad_urls = [
            "http://learning.oreilly.com/course/topic/0642572077884/",
            "https://example.com/course/topic/0642572077884/",
            "https://learning.oreilly.com:8443/course/topic/0642572077884/",
            "https://user:pass@learning.oreilly.com/course/topic/0642572077884/",
            "https://learning.oreilly.com/course/topic/123/",
            "https://learning.oreilly.com/library/view/thing/0642572077884/",
            "",
        ]
        for url in bad_urls:
            with self.subTest(url=url):
                with self.assertRaises(worker.ValidationError):
                    worker.validate_payload({"type": "course", "courseUrl": url})

    def test_unknown_type(self) -> None:
        with self.assertRaises(worker.ValidationError):
            worker.validate_payload({"type": "podcast"})


class RedactionTests(unittest.TestCase):
    def test_sanitize_log_line(self) -> None:
        secrets = ["top-secret-cookie-value"]
        raw = (
            "\x1b[33mUsing session=top-secret-cookie-value\x1b[0m "
            "Kaltura session token acquired: abcdefghijklmnop "
            "https://cdn.example/path/ks/abcdef?ks=deadbeef\r\n"
        )
        line = worker.sanitize_log_line(raw, secrets)
        self.assertNotIn("top-secret-cookie-value", line)
        self.assertNotIn("abcdefghijklmnop", line)
        self.assertNotIn("deadbeef", line)
        self.assertNotIn("\x1b", line)
        self.assertIn("[redacted]", line)

    def test_sanitize_truncates_very_long_lines(self) -> None:
        line = worker.sanitize_log_line("x" * 5000, [])
        self.assertLessEqual(len(line), 4002)
        self.assertTrue(line.endswith("…"))

    def test_extract_error_skips_success_summary(self) -> None:
        lines = [
            "  [1/2] Lesson one",
            "  Failed: 0",
            "  [2/2] Lesson two",
            "    FAILED to download",
        ]
        self.assertEqual(
            worker.extract_error(lines, 1),
            "FAILED to download",
        )
        self.assertEqual(
            worker.extract_error(["Failed: 0"], 0),
            "The downloader exited with code 0.",
        )


class CookieAndOutputTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.config = self.root / "config"
        self.download = self.root / "download"
        self.config.mkdir()
        self.download.mkdir()
        self.original_config = worker.CONFIG_DIR
        self.original_download = worker.DOWNLOAD_DIR
        worker.CONFIG_DIR = self.config
        worker.DOWNLOAD_DIR = self.download

    def tearDown(self) -> None:
        worker.CONFIG_DIR = self.original_config
        worker.DOWNLOAD_DIR = self.original_download
        self.temporary.cleanup()

    def test_preflight_reports_missing_and_invalid_files(self) -> None:
        self.assertIn("Missing cookies.json", worker.preflight_cookies("book"))
        (self.config / "cookies.json").write_text("not json", encoding="utf-8")
        self.assertIn("not valid JSON", worker.preflight_cookies("book"))
        (self.config / "cookies.json").write_text("[]", encoding="utf-8")
        self.assertIn("non-empty JSON object", worker.preflight_cookies("book"))
        (self.config / "cookies.json").write_text(
            json.dumps({"sessionid": "secret-value"}),
            encoding="utf-8",
        )
        self.assertIsNone(worker.preflight_cookies("book"))

    def test_cookie_status_never_includes_values(self) -> None:
        secret = "cookie-value-that-must-not-leak"
        (self.config / "cookies.json").write_text(
            json.dumps({"sessionid": secret}),
            encoding="utf-8",
        )
        statuses = worker.read_cookie_status()
        self.assertTrue(statuses["book"]["valid"])
        self.assertEqual(statuses["book"]["cookieCount"], 1)
        self.assertNotIn(secret, json.dumps(statuses))

    def test_verify_book_outputs(self) -> None:
        job = {
            "type": "book",
            "input": {"title": "Test Book", "format": "both"},
        }
        error, warnings = worker.verify_outputs(job)
        self.assertIn("no valid EPUB", error or "")
        (self.download / "epub").mkdir()
        (self.download / "epub" / "Test Book.epub").write_bytes(b"PK")
        error, warnings = worker.verify_outputs(job)
        self.assertIsNone(error)
        self.assertTrue(any("PDF conversion failed" in item for item in warnings))
        (self.download / "pdf").mkdir()
        (self.download / "pdf" / "Test Book.pdf").write_bytes(b"%PDF")
        error, warnings = worker.verify_outputs(job)
        self.assertIsNone(error)
        self.assertEqual(warnings, [])

    def test_verify_course_outputs(self) -> None:
        job = {
            "type": "course",
            "input": {"courseId": "1234567890", "transcriptsOnly": True},
        }
        error, _ = worker.verify_outputs(job)
        self.assertIn("no course files", error or "")
        course = self.download / "courses" / "course-1234567890" / "Module"
        course.mkdir(parents=True)
        (course / "Lesson.mp4").write_bytes(b"video")
        error, _ = worker.verify_outputs(job)
        self.assertIn("No transcripts", error or "")
        (course / "Lesson.txt").write_text("transcript", encoding="utf-8")
        error, _ = worker.verify_outputs(job)
        self.assertIsNone(error)

    def test_tail_log(self) -> None:
        path = self.root / "job.log"
        path.write_text("\n".join(f"line {i}" for i in range(50)) + "\n")
        lines, truncated = worker.tail_log(path, 10)
        self.assertEqual(lines[-1], "line 49")
        self.assertEqual(len(lines), 10)
        self.assertTrue(truncated)
        missing, truncated = worker.tail_log(self.root / "missing.log")
        self.assertEqual(missing, [])


if __name__ == "__main__":
    unittest.main()
