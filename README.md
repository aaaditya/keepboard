# ClipBridge — personal web clipboard MVP

A web-only Android ↔ iPhone clipboard bridge. No native apps.

## What this MVP does
- Private access code exchanged for a short-lived bearer session token.
- Send text/links from one browser to the other.
- Real-time updates to other open pages using SignalR.
- Copy received text to the device clipboard.
- Paste text from the current device clipboard when the browser permits it.
- Latest clip stored in backend memory.

## Important limitations
- A webpage cannot silently monitor every clipboard change. Use **Paste from this device** or paste into the text box, then Send.
- Clipboard reading requires HTTPS (or localhost) and may require browser permission / a user gesture.
- This starter stores the latest clip in memory. It is lost if the backend restarts or sleeps. Add PostgreSQL when persistence/history is needed.
- This is a personal MVP, not yet production-hardened for public SaaS. Do not send passwords, OTPs, API keys, or other highly sensitive content.
- Keep the access code private. Anyone who knows it can obtain a session token.

## Requirements
- .NET 8 SDK
- Node.js 20+ and npm
- Git (optional)

## 1. Run locally

### Backend
```bash
cd backend/ClipBridge.Api
dotnet run
```
The API will print its local URL. Set an access code before running:

**macOS/Linux**
```bash
export CLIP_ACCESS_CODE='use-a-long-random-passphrase'
export FRONTEND_ORIGIN='http://localhost:5173'
dotnet run
```

**PowerShell**
```powershell
$env:CLIP_ACCESS_CODE = "use-a-long-random-passphrase"
$env:FRONTEND_ORIGIN = "http://localhost:5173"
dotnet run
```

If the API URL is `http://localhost:5000`, use that in the frontend config below. If it prints another port, use that port.

### Frontend
```bash
cd frontend
cp .env.example .env.local
```
Edit `.env.local`:
```env
VITE_API_URL=http://localhost:5000
```
Then:
```bash
npm install
npm run dev
```
Open `http://localhost:5173` on your computer. For testing on phones, local URLs won't be reachable unless you configure LAN access and HTTPS; deploying the services is easier.

## 2. Deploy free-tier version

This repo includes deploy configs:
- `render.yaml` + `backend/ClipBridge.Api/Dockerfile` for the API on Render
- `frontend/vercel.json` + `frontend/vite.config.js` for the UI on Vercel

### Backend on Render (Blueprint)
1. Push this project to GitHub (private repo recommended).
2. In [Render](https://dashboard.render.com): **New → Blueprint** → connect the repository.
3. Render reads `render.yaml` and creates **clipbridge-api** (Docker, free plan).
4. When prompted, set:
   - `CLIP_ACCESS_CODE`: a long random passphrase (do not put it in frontend env)
   - `FRONTEND_ORIGIN`: leave a placeholder for now (update after Vercel deploy), e.g. `https://example.vercel.app`
5. Deploy and copy the Render HTTPS URL, e.g. `https://clipbridge-api.onrender.com`.

**Manual alternative (no Blueprint):** New → Web Service → Docker → Root Directory `backend/ClipBridge.Api`, same env vars as above.

Free services may spin down while idle; the first connection can be slow. Confirm the current free-tier limits before relying on it.

### Frontend on Vercel
1. Import the repository into [Vercel](https://vercel.com).
2. Set **Root Directory** to `frontend` (uses `frontend/vercel.json`).
3. Add environment variable:
   - `VITE_API_URL`: your Render HTTPS URL, without a trailing slash.
4. Deploy.
5. Copy the Vercel origin and set it as `FRONTEND_ORIGIN` in Render, then redeploy the backend.

**Note:** Vite environment variables are public browser configuration. Never place `CLIP_ACCESS_CODE` or any server secret in `VITE_*`.

## 3. Use on your phones
1. Open the Vercel URL in Safari on the iPhone and Chrome on Android.
2. Enter the same access code on both devices.
3. Keep the pages open for instant receiving.
4. On the sending device, tap **Paste from this device** or paste into the text box, then **Send clip**.
5. On the receiving device, tap **Copy latest** and paste into the destination app.

Add the website to the Home Screen if you want quick access. It remains a website; no native app is required.

## Security notes before SaaS
This MVP uses in-memory sessions and one shared personal room. Before public SaaS:
- Add user accounts or passkeys, per-user/device identities and tenant isolation.
- Store clips in PostgreSQL with retention/expiry policies.
- Add rate limiting, request size limits, audit-safe logs, abuse controls and monitoring.
- Use end-to-end encryption with a reviewed key exchange; HTTPS alone does not make server-stored content end-to-end encrypted.
- Avoid logging request bodies or access tokens.
- Add deletion, device revocation, session rotation and security tests.
- Use short clip expiry and clear warnings for sensitive content.
