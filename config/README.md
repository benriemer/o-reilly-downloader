# Cookie configuration

This directory is shared by both containers:

- **downloader** reads it read-only at `/config`
- **web** writes the two cookie files here when you use Settings

The worker links these files to the paths the upstream CLI expects:

| File | Used for |
| --- | --- |
| `cookies.json` | EPUB / PDF book downloads |
| `cookies_full.json` | Video courses, including HttpOnly session cookies |

## Adding cookies

Use **Settings → Cookie files** in the web UI, or place the files here manually.
Both methods produce mode `600` files. The UI never reads cookie values back
into a response, a log, or the browser.

### Book cookies

1. Sign in at <https://learning.oreilly.com>.
2. Open DevTools → Console and run:

   ```js
   JSON.stringify(document.cookie.split(';').reduce((o, c) => {
     const [k, v] = c.trim().split('=');
     o[k] = v;
     return o;
   }, {}))
   ```

3. Paste the output into Settings, or save it as `config/cookies.json`.

### Full course cookies

Course playback needs HttpOnly cookies that `document.cookie` cannot expose.
Capture them with the upstream interactive login, then paste the resulting
`cookies_full.json` into Settings:

```sh
./oreilly.sh login
```

A browser extension that exports HttpOnly cookies also works.

## Permissions

The web container runs as `LOCAL_UID:LOCAL_GID` (default `1000:1000`). If the
UI cannot save cookies, fix ownership on the host:

```sh
sudo chown -R "$(id -u):$(id -g)" config
```

or set `LOCAL_UID` / `LOCAL_GID` in `.env` to match the owner of this folder.

## Security

- Never commit these files. The repository's `.gitignore` excludes them.
- Never paste cookie values into an issue, a screenshot, or a chat.
- Cookies expire. Refresh them if authentication fails.
- This tool is for content you are authorized to access. It does not bypass
  DRM or paywalls.
