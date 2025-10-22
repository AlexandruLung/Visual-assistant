AWS Learning Assistant – Browser Extension (MVP)

How to build and load:

1) Install dependencies (no network here; run locally):
   - npm i

2) Build TS and copy static files:
   - npm run build

3) Load the extension in Chrome/Edge:
   - Open chrome://extensions (edge://extensions)
   - Enable Developer mode
   - Load unpacked → select the `extension/dist/` folder

4) Usage:
   - Open an AWS Console page
   - Press Alt+J to toggle the floating panel
   - Paste your OpenAI API key in the panel or popup (kept in memory only)
   - Ask questions; for highlighting, try: "highlight Create role"

Notes:
- No persistence: API key is kept in the service worker memory only.
- OCR is stubbed; integrate Tesseract.js later for screen keywords.
- OpenAI streaming implemented via SSE parser; replace `model: "gpt-5"` when ready.

Setup & Git

1) Ensure Node.js LTS is installed (includes npm).
2) Install deps and build once:
   - npm install
   - npm run build
3) Initialize Git and make the first commit (from this folder):
   - git init
   - git add .
   - git commit -m "Initial commit: AWS/Google assistant extension"
   - git branch -M main
4) Create a new empty repository (GitHub/GitLab/Bitbucket) and copy its HTTPS URL.
5) Add the remote and push:
   - git remote add origin https://github.com/your-user/your-repo.git
   - git push -u origin main

Important: `.gitignore` excludes `node_modules/` and `dist/`. Your API key is never written to disk; do not add any `.env` files with secrets. Rotate your key if it was ever exposed.
