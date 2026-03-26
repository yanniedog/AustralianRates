# status-download

Apply the **status-download** skill (`.cursor/skills/status-download/SKILL.md`).

1. From **repo root**, run **`npm run fetch-status-debug-bundle`** so **`ADMIN_API_TOKEN`** is loaded from **`.env`** (do not use `YOUR_ADMIN_TOKEN` or paste the secret into curl).
2. Optional: **`npm run fetch-status-debug-bundle -- --out=bundle.json`** for a file; **delete** the file after analysis per project rules.
3. On **PowerShell**, avoid bare **`curl -H ...`** (that invokes `Invoke-WebRequest` and breaks); use the npm script or **`curl.exe`** only if the environment already has a valid Bearer token.

This command is available in chat as **/status-download**.
