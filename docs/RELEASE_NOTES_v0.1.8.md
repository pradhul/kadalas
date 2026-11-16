# Kadalas v0.1.8

Phone feedback release: stability, auth, scan UX, and India-first organize.

## Highlights

1. **White-screen guard** — root error boundary + safer scan-review loading/empty paths.
2. **Google session** — one reconnect banner; silent renew when possible; less “sign in again” churn.
3. **Home CTA** — View scan / Resume / Review N / Scan Gmail based on real scan + review state.
4. **Performance** — throttled scan progress emits, UI yields between batches, FlatList review, progress context split.
5. **Categorisation** — stronger India signals (HDFC/SBI/…, Form 16, Aadhaar, motor OD/TP) shared with AI prompts.
6. **Organize Drive** — preview → move files into category folders (parents only) → undo once. Never trash/delete.

## Safety

Approvals and organize still **never delete or trash** Gmail or Drive files. Index / undo JSON are overwrite-only.
