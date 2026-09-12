#!/usr/bin/env python3
"""
Interactive login helper for O'Reilly course downloader.

Launches a visible Chrome window, lets the user log in to learning.oreilly.com,
then captures all cookies (including HttpOnly) and saves them to cookies_full.json.
"""

import json
import time
import os
from playwright.sync_api import sync_playwright

CHROME_PATH = os.environ.get("CHROME_PATH", "/usr/bin/google-chrome")
OUTPUT_FILE = "cookies_full.json"

def main():
    print("=== O'Reilly Interactive Login ===")
    print()
    print("A Chrome window will open. Please:")
    print("  1. Log in to learning.oreilly.com")
    print("  2. Wait until you see the O'Reilly home page")
    print("  3. Come back here and press Enter")
    print()

    with sync_playwright() as p:
        # Launch visible browser
        browser = p.chromium.launch(
            executable_path=CHROME_PATH,
            headless=False,  # Visible
            args=["--no-sandbox", "--disable-gpu"],
        )
        context = browser.new_context()
        page = context.new_page()

        # Navigate to the login page
        print("Opening learning.oreilly.com...")
        page.goto("https://learning.oreilly.com/home/", wait_until="domcontentloaded", timeout=30000)
        time.sleep(2)

        # If already at login page, navigate there explicitly
        if "login" in page.url.lower() or "member" in page.url.lower():
            page.goto("https://learning.oreilly.com/accounts/login/", wait_until="domcontentloaded", timeout=30000)

        print()
        print("Browser is open. Please log in to O'Reilly.")
        print("Once you're on the learning.oreilly.com home page, come back here.")
        input("Press Enter when you're logged in...")

        # Check if we're logged in
        print()
        print("Checking login status...")
        page.goto("https://learning.oreilly.com/home/", wait_until="domcontentloaded", timeout=30000)
        time.sleep(3)

        if "login" in page.url.lower() or "member" in page.url.lower():
            print("ERROR: You don't appear to be logged in. Please try again.")
            browser.close()
            return False

        print("Login confirmed!")

        # Extract all cookies
        all_cookies = context.cookies()
        print(f"Found {len(all_cookies)} cookies total")

        # Filter to O'Reilly domain cookies
        oreilly_cookies = {}
        for c in all_cookies:
            domain = c.get("domain", "")
            if "oreilly" in domain:
                oreilly_cookies[c["name"]] = c["value"]

        print(f"O'Reilly cookies: {len(oreilly_cookies)}")
        for name in sorted(oreilly_cookies.keys()):
            val = oreilly_cookies[name]
            print(f"  {name}: {val[:30]}..." if len(val) > 30 else f"  {name}: {val}")

        # Check for critical cookies
        critical = ["orm-jwt", "sessionid", "groot_sessionid"]
        missing = [c for c in critical if c not in oreilly_cookies]
        if missing:
            print(f"\nWARNING: Missing critical cookies: {missing}")
            print("The course downloader may not work without these.")

        # Save cookies
        with open(OUTPUT_FILE, "w") as f:
            json.dump(oreilly_cookies, f, indent=2)
        print(f"\nCookies saved to {OUTPUT_FILE}")
        print("You can now run the course downloader.")

        browser.close()
        return True


if __name__ == "__main__":
    main()
