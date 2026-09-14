#!/bin/bash
set -euo pipefail

# O'Reilly Book Downloader (container-native)
# Runs inside the Docker container, calls the sso wrapper directly.

while getopts b:t:f: option
do
    case "${option}" in
        b)  BOOKTITLE=${OPTARG};;
        t)  TITLE=${OPTARG};;
        f)  FORMAT=${OPTARG};;
        *)  echo "Error: aborting"; exit 1 ;;
    esac
done

print_pdf=false
print_epub=false
APPDIR=/app
output_pdf="${APPDIR}/download/pdf"
output_epub="${APPDIR}/download/epub"

if [[ $FORMAT = 'pdf' ]]; then
    echo "Downloading PDF"; print_pdf=true
elif [[ $FORMAT = 'epub' ]]; then
    echo "Downloading EPUB"; print_epub=true
elif [[ $FORMAT = 'both' ]]; then
    echo "Downloading both PDF and EPUB"; print_pdf=true; print_epub=true
else
    echo "Error: -f must be one of: pdf, epub, both"; exit 1
fi

mkdir -p "$output_pdf" "$output_epub"

# Find cookies
cookies_file=""
for candidate in "${APPDIR}/data/cookies.json" "${APPDIR}/cookies.json"; do
    if [[ -f "$candidate" ]]; then cookies_file="$candidate"; break; fi
done
if [[ -z "$cookies_file" ]]; then
    echo "Error: cookies.json not found at ${APPDIR}/cookies.json"
    exit 1
fi
echo "Using cookies from: $cookies_file"

# Find patched safaribooks
safaribooks_patched="${APPDIR}/safaribooks-v2.py"
if [[ ! -f "$safaribooks_patched" ]]; then
    echo "Error: $safaribooks_patched not found."; exit 1
fi

# TLS config
tls12_conf="${APPDIR}/openssl-tls12.cnf"
if [[ ! -f "$tls12_conf" ]]; then
    echo "Error: $tls12_conf not found."; exit 1
fi

if [[ "$print_pdf" = true ]] && ! command -v ebook-convert >/dev/null 2>&1; then
    echo "Error: 'ebook-convert' (calibre) required for PDF output."; exit 1
fi

# Run safaribooks.py directly (bypass sso wrapper which has cookie piping issues)
WORKDIR=$(mktemp -d)
trap 'rm -rf "$WORKDIR"' EXIT
cp "$safaribooks_patched" "$WORKDIR/safaribooks.py"
cp "$cookies_file" "$WORKDIR/cookies.json"

export OPENSSL_CONF="$tls12_conf"

BOOK="${APPDIR}/${TITLE}.epub"
echo "Downloading book $BOOKTITLE..."

(cd "$WORKDIR" && python3 safaribooks.py "$BOOKTITLE")

# Find the generated epub
EPUB=$(find "$WORKDIR" -name "${BOOKTITLE}.epub" -print -quit)
if [[ -z "$EPUB" ]]; then
    echo "Error: download failed - no epub file generated."
    echo "  1. Cookies expired — re-extract from browser"
    echo "  2. Wrong book ID"
    exit 1
fi
cp "$EPUB" "$BOOK"

# Validate: real epub starts with PK zip magic
if [[ ! -s "$BOOK" ]] || ! head -c 4 "$BOOK" | grep -q $'PK\x03\x04'; then
    echo "Error: download failed - the epub is empty or invalid."
    echo "  1. Cookies expired — re-extract from browser"
    echo "  2. Wrong book ID"
    rm -f "$BOOK"; exit 1
fi

# Save EPUB first so PDF conversion failure doesn't lose it
if [[ "${print_epub}" = true ]]; then
    mv "$BOOK" "${output_epub}/${TITLE}.epub"
    BOOK="${output_epub}/${TITLE}.epub"
else
    cp "$BOOK" "${APPDIR}/${TITLE}.epub"
    BOOK="${APPDIR}/${TITLE}.epub"
fi

if [[ "${print_pdf}" = true ]]; then
    echo "Converting to PDF..."
    if QTWEBENGINE_DISABLE_SANDBOX=1 ebook-convert "$BOOK" "${output_pdf}/${TITLE}.pdf" 2>&1; then
        echo "PDF conversion complete"
    else
        echo "Warning: PDF conversion failed (EPUB was saved)"
    fi
fi

# Clean up temp epub copy if epub wasn't requested
if [[ "${print_epub}" != true ]]; then
    rm -f "$BOOK"
fi

echo "$BOOKTITLE downloaded successfully"
