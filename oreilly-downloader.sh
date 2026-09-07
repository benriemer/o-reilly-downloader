#!/bin/bash
set -euo pipefail

while getopts b:t:f: option
do
    case "${option}" in
        b)  BOOKTITLE=${OPTARG};;
        t)  TITLE=${OPTARG};;
        f)  FORMAT=${OPTARG};;
        *)  echo "Error: aborting"
        exit 1 ;;
    esac
done

print_pdf=false
print_epub=false
CURDIR=$(pwd)
output_pdf="${CURDIR}/download/pdf"
output_epub="${CURDIR}/download/epub"

if [[ $FORMAT = 'pdf' ]]
then
    echo "Downloading PDF"
    print_pdf=true
elif [[ $FORMAT = 'epub' ]]
then
    echo "Downloading EPUB"
    print_epub=true
elif [[ $FORMAT = 'both' ]]
then
    echo "Downloading both PDF and EPUB"
    print_pdf=true
    print_epub=true
else
    echo "Error: -f must be one of: pdf, epub, both"
    exit 1
fi

if [[ ! -d "$output_pdf" || ! -d "$output_epub" ]];
then
    mkdir -p "$output_pdf"
    mkdir -p "$output_epub"
fi

# --- Cookies (O'Reilly now blocks username/password login; cookies are required) ---
# Resolve cookies.json: prefer data/cookies.json, then ./cookies.json
cookies_file=""
for candidate in "${CURDIR}/data/cookies.json" "${CURDIR}/cookies.json"; do
    if [[ -f "$candidate" ]]; then
        cookies_file="$candidate"
        break
    fi
done
if [[ -z "$cookies_file" ]]
then
    echo "Error: cookies.json not found."
    echo ""
    echo "O'Reilly no longer allows username/password login via scripts."
    echo "You must extract cookies from a logged-in browser session:"
    echo ""
    echo "  Option A (browser console):"
    echo "    1. Log in at https://learning.oreilly.com in your browser"
    echo "    2. Open the developer console (F12) on that page"
    echo "    3. Run this JS and copy the output:"
    echo "       JSON.stringify(document.cookie.split(';').reduce((o,c)=>{let[k,v]=c.trim().split('=');o[k]=v;return o;},{}))"
    echo "    4. Save it as ${CURDIR}/cookies.json"
    echo ""
    echo "  Option B (retrieve_cookies.py helper):"
    echo "    python3 retrieve_cookies.py --paste"
    echo ""
    exit 1
fi
echo "Using cookies from: $cookies_file"

# --- Patched safaribooks.py (v2 API + cookie auth) ---
# O'Reilly's v1 API (/api/v1/book/) returns 404; the bundled safaribooks.py is
# from 2022 and uses v1. We mount a patched version (v2 API) into the container.
safaribooks_patched="${CURDIR}/safaribooks-v2.py"
if [[ ! -f "$safaribooks_patched" ]]
then
    echo "Error: $safaribooks_patched not found. It is required (v2 API patch)."
    exit 1
fi

# --- OpenSSL config: force TLS 1.2 ---
# Akamai's edge closes TLS 1.3 handshakes to learning.oreilly.com
# (unexpected EOF during ClientHello). Forcing TLS 1.2 works around this.
tls12_conf="${CURDIR}/openssl-tls12.cnf"
if [[ ! -f "$tls12_conf" ]]
then
    echo "Error: $tls12_conf not found. It is required for the O'Reilly TLS workaround."
    exit 1
fi

if [[ "$print_pdf" = true ]]
then
    if ! command -v ebook-convert >/dev/null 2>&1
    then
        echo "Error: 'ebook-convert' (calibre) is required for PDF output but was not found."
        echo "Install calibre: https://calibre-ebook.com/"
        exit 1
    fi
fi

BOOK="${CURDIR}/${TITLE}.epub"

# Pre-clean any stale container with the same name, then auto-remove on exit
docker container rm -f "$TITLE" >/dev/null 2>&1 || true

# Download via the sso wrapper (pipes cookies.json in), with the patched
# safaribooks.py and TLS 1.2 config mounted into the container.
(cat "$cookies_file" | \
docker run --rm -i --name "$TITLE" \
    -v "${safaribooks_patched}":/safaribooks/safaribooks.py:ro \
    -v "${tls12_conf}":/etc/ssl/tls12.cnf:ro \
    -e OPENSSL_CONF=/etc/ssl/tls12.cnf \
    kirinnee/orly:latest sso "$BOOKTITLE") > "$BOOK"

# Validate the download: a real epub is a non-empty ZIP (starts with PK\x03\x04)
if [[ ! -s "$BOOK" ]] || ! head -c 4 "$BOOK" | grep -q $'PK\x03\x04'
then
    echo "Error: download failed - the epub is empty or invalid."
    echo "The most likely causes:"
    echo "  1. Your cookies have expired - re-extract them from your browser"
    echo "  2. The book ID is wrong"
    echo "Check the docker output above for the actual error."
    rm -f "$BOOK"
    exit 1
fi

if [[ "${print_pdf}" = true ]]
then
    ebook-convert "$BOOK" "${CURDIR}/${TITLE}.pdf"
    mv "${CURDIR}/${TITLE}.pdf" "${output_pdf}/${TITLE}.pdf"
fi

if [[ "${print_epub}" = true ]]
then
    mv "$BOOK" "${output_epub}/${TITLE}.epub"
else
    rm -f "$BOOK"
fi

echo "$BOOKTITLE downloaded successfully"
