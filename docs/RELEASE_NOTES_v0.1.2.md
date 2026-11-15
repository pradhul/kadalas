# Kadalas v0.1.2 (pre-release)

Fixes real-device web Google sign-in on Netlify (no client secret).

## Highlights

- Web auth via Google Identity Services token client (popup; works on phone browsers)
- Silent token renew + “Session expired — tap to reconnect Google”; scan pauses/resumes on auth expiry
- Friendly sign-in errors; OAuth developer hint only in `__DEV__`
