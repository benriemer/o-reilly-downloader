#!/bin/bash
# =============================================================================
# Host wrapper for the unified O'Reilly Docker image
#
# Usage:
#   ./oreilly.sh book   -b <id> -t <title> -f <pdf|epub|both>
#   ./oreilly.sh course <course_url> [--transcripts-only]
#   ./oreilly.sh login
#   ./oreilly.sh help
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IMAGE="oreilly-downloader:latest"

# Build volume mounts
VOLUMES=""

if [[ -f "$SCRIPT_DIR/cookies.json" ]]; then
    VOLUMES="$VOLUMES -v ${SCRIPT_DIR}/cookies.json:/app/cookies.json:ro"
fi
if [[ -f "$SCRIPT_DIR/cookies_full.json" ]]; then
    VOLUMES="$VOLUMES -v ${SCRIPT_DIR}/cookies_full.json:/app/cookies_full.json:ro"
fi

# For login command, mount the output directory for saving cookies + X11
if [[ "${1:-}" == "login" ]]; then
    exec docker run --rm --interactive \
        -e DISPLAY="${DISPLAY:-}" \
        -v /tmp/.X11-unix:/tmp/.X11-unix:ro \
        -v "${SCRIPT_DIR}":/app/output \
        $IMAGE login
fi

# For book/course commands, mount the download directory
exec docker run --rm --interactive \
    $VOLUMES \
    -v "${SCRIPT_DIR}/download":/app/download \
    $IMAGE "$@"
