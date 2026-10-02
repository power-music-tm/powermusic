# Gmail / Google Cloud Setup Guide (Pilot 2)

This is the exact setup we used in development. At handover, repeat the same
steps inside **Power Music's own Google account** so they own everything.

## What this setup gives you

The email agent needs Google's permission to read inboxes and send replies.
Google requires: one Cloud project, the Gmail API turned on, one "OAuth app"
(the identity our backend uses), and a one-time approval per inbox.

## Steps

### 1. Create a Google Cloud project
1. Go to console.cloud.google.com and sign in.
2. Create a new project, e.g. **"Power Music Email Pilot"**.
3. Pick the billing account when asked (the Gmail API itself is free).

### 2. Turn on the Gmail API
1. In the project, go to **APIs & Services → Library**.
2. Search **Gmail API** → click **Enable**.

### 3. Set up the OAuth consent screen (Google Auth Platform)
1. Go to **Google Auth Platform → Overview** → **Get started**.
2. App name: **Power Music Email Agent**. Support email: the admin's email.
3. Audience:
   - **Internal** if the account is Google Workspace (this is the right
     choice for Power Music at handover — no warnings, no verification).
   - **External** only for plain @gmail.com accounts (what we used in dev).
4. Contact email → agree to the User Data Policy → **Create**.

### 4. Create the OAuth client
1. Go to **Google Auth Platform → Clients → Create client**.
2. Application type: **Web application**. Name: e.g. "Power Music Backend".
3. Authorized redirect URI:
   - Dev: `http://localhost:8000/api/pilot2/inboxes/oauth/callback`
   - Production: `https://<backend-domain>/api/pilot2/inboxes/oauth/callback`
4. Click **Create**, then copy the **Client ID** and **Client secret**.

### 5. Add test users (External/testing mode only)
1. **Google Auth Platform → Audience → Test users → Add users.**
2. Add every Gmail address that will connect an inbox.
3. Note: in testing mode, tokens expire every 7 days (reconnect needed).
   Internal apps (Workspace) do not have this problem.

### 6. Configure the backend
Add to `backend/.env`:

```
PILOT2_GMAIL_MODE=live
GOOGLE_CLIENT_ID=<client id>
GOOGLE_CLIENT_SECRET=<client secret>
GOOGLE_REDIRECT_URI=http://localhost:8000/api/pilot2/inboxes/oauth/callback
GEMINI_API_KEY=<key from aistudio.google.com>
```

### 7. Connect each inbox (one time per inbox)
1. Open the dashboard → **Email accounts** page.
2. Click **Connect** on an inbox row.
3. A Google tab opens: sign in with THAT inbox's account and click **Allow**.
4. The page says "Inbox connected" — done. Repeat per inbox.

## About the "Google hasn't verified this app" warning

- It appears because the app is **External** and **not verified** by Google.
- **The fix for Power Music: use an Internal app.** Their inboxes live in
  Google Workspace, so when we create the OAuth app inside their Cloud
  project, we pick Audience = **Internal**. Internal apps show no warning,
  need no Google verification, and tokens never expire after 7 days.
  It takes zero extra time.
- Full Google verification (for public apps) is only needed if strangers
  connect their inboxes. It involves a Google review plus a paid yearly
  security audit (CASA) because Gmail scopes are "restricted". Weeks of
  effort — not needed for this pilot.
