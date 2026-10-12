# Security test report

**Project:** Power Music  
**Date:** 12 Oct 2026  
**Result:** All listed tests **passed**

---

## Summary

We ran security and edge-case tests on login, admin APIs, public APIs, CORS, and injection attacks.  
**Nothing critical failed.** One small bug was found and fixed (empty email local-part like `@puregym.com` was wrongly allowed).

---

## Types of testing

| Type | What it means | Result |
|------|----------------|--------|
| **Auth tests** | Can only real admins use admin APIs? Can managers get in? | Pass |
| **Trust-boundary tests** | Does the backend ignore “I’m admin” / wrong partner from the browser? | Pass |
| **CORS tests** | Can a bad website call our API from the browser? | Pass |
| **Cookie / token tests** | Do fake cookies or fake tokens unlock the API? | Pass |
| **Injection tests** | SQL tricks, script/XSS, CSV formula attacks | Pass |
| **Public API tests** | Can strangers list all company email domains? | Pass |
| **Seed / secret tests** | Are default passwords baked into seed scripts? | Pass |
| **Allowlist tests** | Hardcoded admin email removed; spoof emails blocked | Pass |

---

## What we checked (plain English)

1. **No login / wrong login** → admin APIs blocked  
2. **Manager account** → cannot call admin APIs  
3. **Browser claims** (role, partner header, cookies) → server decides from DB + real token  
4. **Evil website origin** → CORS blocks it  
5. **SQL-style search text** → treated as text, not run as SQL  
6. **JS / HTML attacks** in names and email HTML → rejected or cleaned (DOMPurify)  
7. **Public domain list** → only scoped answers (by email or partner), not the full list  
8. **Seed scripts** → require real env vars; no baked-in passwords  

---

## Numbers

| Suite | Passed |
|-------|--------|
| Backend OWASP / auth / CORS / injection | 27 |
| Backend domain / cron / JWT / email attacks (+ related) | ~90+ in security set |
| Frontend allowlist + manager validation + XSS | 14 |
| Seed credential guards | 6 |

---

## Bug found in testing

| Issue | Fix |
|-------|-----|
| Email like `@puregym.com` (nothing before `@`) matched as allowed | Matcher now needs a real name before `@` |

---

## How to run again

```bash
# Backend security suite
cd backend && source .venv-mac/bin/activate
pytest tests/test_owasp_auth_cors_injection.py \
       tests/test_public_domain_enumeration_security.py \
       tests/test_cron_auth_security.py \
       tests/test_bearer_auth_security.py \
       tests/test_email_domain_attack_vectors.py -q

# Frontend
cd frontend && node --test \
  tests/admin_access_security.test.js \
  tests/manager_auth_security.test.js \
  tests/xss_safe_html_security.test.js

# Seed guards
node --test scripts/tests/seed_guards_security.test.mjs
```

---

## Bottom line

Auth and API security look **solid** for handover.  
The backend **does not trust** the frontend for role or partner.  
Re-run the commands above after big auth changes.
