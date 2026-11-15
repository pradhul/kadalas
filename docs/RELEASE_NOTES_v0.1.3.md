# Kadalas v0.1.3 (pre-release)

Fixes phone-test AI model 404s and scan triage aborting the job.

## Highlights

- Live model IDs: Gemini `gemini-3.5-flash-lite`, Groq `openai/gpt-oss-20b`, OpenRouter `openrouter/free`
- Triage falls back to rules on non-quota AI errors so review/vault still fill
- Friendlier Test key + vault-not-loaded errors; GIS scope check for Gmail + Drive
