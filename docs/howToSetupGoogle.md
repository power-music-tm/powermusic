What I did, step by step:

Created a Cloud project at console.cloud.google.com → "Power Music Email Pilot" (picked your Vector billing account — Gmail API is free).
Enabled the Gmail API (APIs & Services → Library → Gmail API → Enable).
Set up the OAuth consent screen (Google Auth Platform → Get started): app name "Power Music Email Agent", your email as support contact, audience = External, agreed to the User Data Policy.
Created the OAuth client (Clients → Create): type Web application, redirect URI http://localhost:8000/api/pilot2/inboxes/oauth/callback → got a Client ID + Secret, saved them into backend/.env.
Added you as a test user (Audience → Test users) — required while the app is in testing mode.
You clicked Connect → Google consent screen → Allow. The backend stored the token. Done.
For the client, it's the same 6 steps in their Google account — with one difference explained in point 3 below.