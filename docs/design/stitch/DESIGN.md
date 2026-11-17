# Kadalas — "Calm File Cabinet" design system

Kadalas (Malayalam for "papers") is a personal document vault that finds important documents in the user's own Gmail, lets them review AI suggestions, and keeps approved docs as Gmail pointers or Drive copies. Tone: calm, trustworthy, quiet, precise. Like a well-kept paper file cabinet. Indian context (₹, Aadhaar, PAN, KA-01-AB-1234). Always mask numbers (XXXX XXXX 4821).

## Colors (light mode)
- primary / brand: #0F5E52 (deep teal ink). primary-hover #0B4A41. on-primary #FFFFFF
- primary-container (selected chip, active nav): #DCEFEA, on-primary-container #0B4A41
- background (paper): #F7F6F2
- surface (cards, panes): #FFFFFF
- surface-muted (inputs, sidebar, table header): #F1EFE9
- border / divider: #E4E1D8; border-strong #CFCBBF
- text-primary (ink): #1C2321; text-secondary: #5B6461; text-tertiary: #8A918E
- success (approved, valid, High confidence): #1E7A4C on #E3F3EA
- warning (expiring ≤60d, Medium confidence, quota paused): #A35F00 on #FCEFD9
- danger (expired, Low confidence "Not sure"): #B3261E on #FBE4E2
- info (Gmail pointer / source email): #2F5DA8 on #E5ECF8
- focus ring: 2px #0F5E52 at 40% + 2px offset

## Typography
- Headlines: Manrope (600/700). Body + UI: Inter (400/500/600). Numbers/IDs: Inter tabular, or JetBrains Mono for masked numbers.
- display 32/40 700; h1 24/32 700; h2 20/28 600; h3 16/24 600; body 14/20 400; body-lg 16/24; label 13/16 500; caption 12/16 500; overline 11/16 600 uppercase +0.06em.

## Spacing (4px base)
4, 8, 12, 16, 20, 24, 32, 40, 48, 64. Dense list rows 56px high (desktop) / 64px (mobile). Page padding 24 desktop, 16 mobile.

## Shape & elevation
- Radius: 8 (inputs, buttons, rows), 12 (cards, panes, sheets), 999 (chips, badges). Bottom sheets 16 top corners.
- Elevation: mostly borders (1px #E4E1D8). Shadow only for floating: 0 1px 2px rgba(28,35,33,.06), 0 8px 24px rgba(28,35,33,.08).

## Layout
- Desktop 1440: left sidebar nav 240px (logo, Home/My documents, Review with count badge, Scan, Expiring, Vehicles, Settings; account at bottom), main list column flexible, right detail/preview pane 420–480px.
- Mobile 390: top app bar + bottom tab bar (Home, Review, Scan, Expiring, Settings), 48px min touch targets, primary actions in thumb zone, bottom sheets for detail/email.

## Components
- Document row: category icon in 36px tinted square, title (h3), meta line (issuer · date), right side: storage badge (Gmail pointer = envelope icon info, Drive copy = drive icon, Offline = download-check icon) + expiry badge (Valid till / Expires in 23 days warning / Expired danger). States: default, hover (surface-muted), selected (primary-container left 3px bar), focus.
- Count tiles: Docs / To review / Expiring — number big (h1), label caption; clickable.
- Category chips: pill, outlined default, filled primary-container when selected, with count.
- Badges: pill 20px high caption text, tinted bg.
- Confidence badge: High (success), Medium (warning), Low (danger, text "Not sure — check before approving").
- Buttons: primary filled teal; secondary outlined; tertiary text; destructive text red. Heights 40 desktop / 48 mobile. Show keyboard shortcut hint as small kbd chip (A, S, U, J/K, E) on web.
- Source email panel: always visible on desktop review (From, Subject, Date, snippet, attachment preview, Open in Gmail).
- Toast with Undo: dark ink #1C2321 bg, white text, "Approved · saved as Gmail pointer  Undo".
- Progress stepper for scan: stages Connect → Search Gmail → Read attachments → Classify with AI → Ready to review.
