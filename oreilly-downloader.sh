#!/bin/bash
# =============================================================================
# Legacy book download interface — delegates to oreilly.sh (unified Docker image)
#
# Usage:
#   ./oreilly-downloader.sh -b <book_id> -t <title> -f <pdf|epub|both>
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# This script is kept for backward compatibility. It delegates to the unified
# Docker image via oreilly.sh, which handles volume mounts and cookie files.
exec bash "${SCRIPT_DIR}/oreilly.sh" book "$@"
