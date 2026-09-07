# =============================================================================
# Unified O'Reilly Downloader — Dockerfile
#
# Handles BOTH:
#   - Books  (EPUB + PDF via safaribooks + calibre)
#   - Courses (video + transcripts via Playwright/Chromium + ffmpeg + Kaltura API)
#
# Based on kirinnee/orly (Debian 12 / Bookworm, OpenSSL 3.0.x — compatible with
# O'Reilly's Akamai TLS endpoint).
# =============================================================================

FROM kirinnee/orly:latest

# Switch to root for system package installs
USER root

# Install:
#   - chromium:        headless browser for Playwright (course page scraping)
#   - ffmpeg:          HLS video download for courses
#   - calibre:         ebook-convert for EPUB -> PDF conversion
#   - python3-pip:     to install Python packages
#   - misc libs:       needed by Chromium
RUN apt-get update && apt-get install -y --no-install-recommends \
        chromium \
        ffmpeg \
        calibre \
        python3-pip \
        fonts-liberation \
        fonts-noto-color-emoji \
        libnss3 \
        libxss1 \
        libasound2 \
        libgbm1 \
        libxshmfence1 \
        xvfb \
        && rm -rf /var/lib/apt/lists/*

# Install Python dependencies for the course downloader
# (the base image has python3; we add playwright + requests)
RUN pip3 install --no-cache-dir --break-system-packages \
        playwright==1.49.1 \
        requests==2.32.3 \
    || pip3 install --no-cache-dir \
        playwright==1.49.1 \
        requests==2.32.3

# Playwright browser deps (Chromium runtime libraries)
RUN playwright install-deps chromium 2>/dev/null || true

# Working directory
WORKDIR /app

# Copy all scripts and config
COPY oreilly-downloader.sh .
COPY oreilly-downloader-container.sh .
COPY safaribooks-v2.py .
COPY openssl-tls12.cnf .
COPY oreilly-course-downloader.py .
COPY oreilly-login.py .
COPY retrieve_cookies.py .
COPY docker-entrypoint.sh .

# Make scripts executable
RUN chmod +x oreilly-downloader.sh oreilly-downloader-container.sh docker-entrypoint.sh

# Create output directories
RUN mkdir -p /app/download/epub /app/download/pdf /app/download/courses

# Environment
ENV CHROME_PATH=/usr/bin/chromium
ENV PYTHONUNBUFFERED=1

# Entrypoint dispatches to book/course/login subcommands
ENTRYPOINT ["/app/docker-entrypoint.sh"]
