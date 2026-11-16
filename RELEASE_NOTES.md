# Kadalas v0.1.12

## Home layout (phone)

On ~390px-wide screens the Home header sat above the document `FlatList` and consumed most of the viewport, so only one card showed. Home now uses a compact top chrome (dash chips, search, one-line category chips) and a `flex:1` `SectionList` of dense ~64px rows with collapsible Recent/category sections — **7+ rows** visible at 390×844 with sample data.

Screenshot: `/opt/cursor/artifacts/home-my-documents-390x844.png`

Review, Search, folder Vault, and Expiring use the same single-list + `ListHeaderComponent` / `flex:1` pattern (no nested vertical ScrollViews).
