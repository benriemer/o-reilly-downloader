#!/bin/bash
set -euo pipefail

# =============================================================================
# Unified O'Reilly Downloader Entry Point
#
# Usage:
#   docker run --rm \
#     -v "$PWD/cookies.json":/app/cookies.json:ro \
#     -v "$PWD/cookies_full.json":/app/cookies_full.json:ro \
#     -v "$PWD/download":/app/download \
#     oreilly-downloader <command> [args...]
#
# Commands:
#   book   -b <id> -t <title> -f <pdf|epub|both>   Download a book
#   course <course_url> [--transcripts-only]        Download a video course
#   login                                            Interactive browser login (needs X11)
# =============================================================================

CURDIR=/app
COOKIES="${CURDIR}/cookies.json"
COOKIES_FULL="${CURDIR}/cookies_full.json"

show_help() {
    cat <<'HELP'
O'Reilly Downloader — Unified Docker Image

Commands:
  book   -b <id> -t <title> -f <pdf|epub|both>
          Download a book as EPUB and/or PDF

  course <course_url> [--transcripts-only] [--output-dir DIR]
          Download a video course (MP4 videos + transcripts)

  login
          Interactive browser login to capture full cookies

Examples:
  # Download a book:
  docker run --rm \
    -v "$PWD/cookies.json":/app/cookies.json:ro \
    -v "$PWD/download":/app/download \
    oreilly-downloader book -b 0642572274566 -t the-agentic-enterprise -f both

  # Download a course:
  docker run --rm \
    -v "$PWD/cookies_full.json":/app/cookies_full.json:ro \
    -v "$PWD/download":/app/download \
    oreilly-downloader course 'https://learning.oreilly.com/course/building-ai-agents/0642572077884/'

  # Interactive login (needs X11):
  docker run --rm \
    -e DISPLAY=$DISPLAY \
    -v /tmp/.X11-unix:/tmp/.X11-unix \
    -v "$PWD":/app/output \
    oreilly-downloader login
HELP
}

COMMAND="${1:-help}"
shift || true

# Help doesn't need cookies
if [[ "$COMMAND" == "help" || "$COMMAND" == "--help" || "$COMMAND" == "-h" ]]; then
    show_help
    exit 0
fi

# Check cookies exist for actual commands
if [[ ! -f "$COOKIES" && ! -f "$COOKIES_FULL" ]]; then
    echo "Error: No cookies file found."
    echo "  Mount cookies.json (for books) or cookies_full.json (for courses) into /app/"
    echo ""
    echo "  Example:"
    echo "    docker run --rm -v \"\$PWD/cookies.json\":/app/cookies.json:ro ..."
    exit 1
fi

case "$COMMAND" in
    book)
        # Book download — uses safaribooks-v2.py + calibre (container-native)
        exec bash "${CURDIR}/oreilly-downloader-container.sh" "$@"
        ;;

    course)
        # Course download — uses Playwright/Chromium + ffmpeg + Kaltura API
        COURSE_URL="${1:-}"
        if [[ -z "$COURSE_URL" ]]; then
            echo "Error: course URL required"
            echo "  Usage: docker run --rm ... oreilly-downloader course <course_url> [--transcripts-only]"
            exit 1
        fi
        shift

        # Course downloads specifically need cookies_full.json (HttpOnly cookies)
        if [[ ! -f "$COOKIES_FULL" ]]; then
            echo "Error: cookies_full.json not found."
            echo "  Course downloads need full cookies (including HttpOnly sessionid)."
            echo "  Run './oreilly.sh login' to capture them."
            exit 1
        fi
        echo "Using full cookies from cookies_full.json"

        exec python3 "${CURDIR}/oreilly-course-downloader.py" "$COURSE_URL" "$@"
        ;;

    login)
        # Interactive login — needs X11 forwarding or a display
        echo "Interactive login mode"
        echo "Note: This requires X11 forwarding or a display server."
        echo "  On Linux:  docker run --rm -e DISPLAY=\$DISPLAY -v /tmp/.X11-unix:/tmp/.X11-unix ... login"
        echo ""
        exec python3 "${CURDIR}/oreilly-login.py"
        ;;

    *)
        echo "Error: Unknown command '$COMMAND'"
        echo "Run 'docker run --rm ... oreilly-downloader help' for usage."
        exit 1
        ;;
esac
