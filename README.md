# Craigslist iOS redesign: browser prototype

A static HTML/CSS/JavaScript prototype of the Craigslist iOS car-shopping redesign. It's a 430 × 932 pt iPhone screen, aligned with the prototype update handoff in the Figma file `uBDKd4xLS50msiung2aDGJ`.

**Live:** <https://rockysahooart.github.io/craigslist-livefront-prototype/>. Open it on a phone for the full-screen version.

- **Phone (≤ 520 px wide):** full screen, app-like. It uses the device's safe areas and keyboard, with no simulated status bar or annotations.
- **Desktop:** the app sits in a contained 430 × 932 pt phone with reviewer notes beside it. The notes also hold the simulation controls.

## Run

```bash
python3 -m http.server 8000
```

Open <http://localhost:8000>. It's static files with relative paths, so the existing GitHub Pages setup (`main`, root folder) serves it unchanged.

**Simulating network and data states**
- **Desktop:** use the controls in the notes panel: Network (Normal · Slow · Fail once) and "2016 VW Golf removed by its seller".
- **Phone:** add URL parameters: `?network=slow`, `?network=fail`, `?removed=L01`.

## Files

```
index.html     page shell, desktop reviewer notes and simulation controls, app root
css/app.css    Figma tokens, materials, layout, states
js/data.js     sample listings and details (one record per listing), recent searches, categories
js/app.js      one store; Home, browsing, search, results, price and Filters sheets, map, details, edge states
assets/        Figma exports (icons, photos, maps), derived icons (purple star, purple caret, filled pickup area), Inter font (OFL)
```

## Verification

An automated run with real taps, clicks and typing walks the spec's full journey and edge cases. It passes all 173 checks: 87 at 430 × 932 (mobile, touch) and 86 at 1440 px wide (desktop). The updated Figma frames were also compared side by side.

## Sample data

| ID | Listing | Price | Mileage | Seller | Posted | Area |
|---|---|---|---|---|---|---|
| L01 | 2016 VW Golf | $8,900 | 92,000 mi | Owner | 1 hr | Northeast |
| L02 | 2019 VW Golf SE (no photo) | $13,900 | 41,000 mi | Dealer | 2 hr | Edina |
| L03 | 2015 VW Golf | $7,500 | 112,000 mi | Owner | 2 hr | St. Paul |
| L04 | 2017 VW Golf | $9,600 | 98,000 mi | Dealer | 3 hr | Richfield |
| L05 | 2014 VW Golf | $6,800 | 128,000 mi | Owner | 4 hr | Bloomington |
| L06 | 2018 Honda Civic | $12,500 | 78,000 mi | Dealer | 2 hr | St. Paul |
| L07 | 2015 Subaru Outback | $9,800 | 104,000 mi | Owner | 3 hr | Richfield |
| L08 | 2017 Toyota RAV4 | $14,900 | 105,000 mi | Dealer | 4 hr | Bloomington |
| L09 | Mid-century dresser (Home only) | $240 | Walnut, 6 drawers | — | 2 hr | Northeast |

**Matching rules**
- Search is case-insensitive and treats "Volkswagen" as "VW".
- Newest means fewest hours, and the maximum price is inclusive.
- Cars & trucks with no query shows L01, L06, L07, L08.
- "Volkswagen Golf" gives 5 at Any price, 4 at a $10,000 maximum, and none at $5,000.

**Filters on top of "Up to $10,000"**

| Seller | Mileage | Results |
|---|---|---|
| All | Any | 4 |
| Owner | Any | 3 |
| Dealer | Any | 1 |
| All | Under 100,000 mi | 2 |
| Owner | Under 100,000 mi | 1 |
| Dealer | Under 100,000 mi | 1 |

**Shared data:** one record per listing feeds cards, markers and details. The card thumbnail is the same image as details photo 1. The list count, cards and markers always come from the same filtered set.

## Working

- **Home:** the map shows only the 25-mile circle, with no markers and no centre dot. The search field leads the sheet. Pills: Minneapolis and 25 miles (applied, caret), All categories (default).
- **Category picker:** Close, or choosing the same category, changes nothing. Cars & trucks opens browsing at a sheet top of 147.
- **Browsing:** cards L01, L06, L07, L08. Markers $8,900, $12,500, and a "2 listings" cluster (Richfield and Bloomington).
- **Search entry:**
  - The field is focused with the purple ring, above the scope line "Cars & trucks · Minneapolis · 25 miles".
  - Recent searches show the query first.
  - The Search key, or the recent "Volkswagen Golf", runs the search. Cancel discards typed text and keeps every filter.
- **Results:** the header shows "Cars & trucks · Minneapolis · 25 miles" beside Expand map. Any price gives 5 results; markers represent 5 listings, including Edina at $13,900.
- **Price sheet:** minimum and maximum fields with a numeric keypad, Clear price (draft only; disabled when there's nothing to clear), Apply, Close, and tapping the scrim.
  - Applied as "Up to $10,000" with a separate 44 × 44 ×, Filters (1), 4 results, and the row scrolled to the price pill.
  - × reruns the search, keeping query, category, location and radius.
- **Filters sheet** (from Filters on price-filtered results):
  - Segmented Seller type (All · Owner · Dealer) and Mileage (Any · Under 100,000 mi), plus the spec's note.
  - "Show N results" counts from the draft, with "1 result" in the singular. Clear all resets the draft to All/Any. Close or the scrim discards.
  - After Apply: list, count, markers and Filters (n) update, and "Also filtered: …" appears in 15 pt purple. The price pill then shows a caret and no ×.
- **Map:**
  - Expand map, the grabber (drag, tap, or Enter/Space/arrow keys) and Collapse map switch between the list (sheet top 147) and the map (192 pt sheet with "N results · query").
  - The map label reads "Approximate listing locations · 25-mile search area".
  - Tapping a marker selects it and shows a 398 × 100 preview with photo, title, price badge and "Northeast · Approximate location". The preview opens details; × deselects.
  - Tapping a cluster spreads it into its price markers.
- **Details:**
  - Close (left) and the Save star (right). The star toggles in place, persists in this browser, and is announced as "Save to Favorites".
  - "Photo 1 of 6" with six page dots.
  - Facts grid "Seller-provided details", with "Not provided" for missing facts.
  - The pickup area is a soft 12% purple fill with no ring.
  - The fixed contact area above the home indicator.
  - Close restores the opening screen: browsing, results, or the map with the same marker selected, plus list scroll and filter-row position.
- **States:**
  - **First load:** skeleton cards with "Loading listings…".
  - **Slow apply:** previous results are dimmed and labelled "Previous results · Any price · 5 listings", with a spinner and "Applying Up to $10,000…". Pills, the Filters label and markers keep the previous context, and a $13,900 car never shows under an applied $10,000.
  - **Failure:** "Couldn't apply Up to $10,000" with Retry, which repeats the same query and filters.
  - **No results:** at $5,000, "Remove price filter" brings back 5 results.
  - **Missing data:** "No photo provided".
  - **Removed listing:** "This listing is no longer available." Back to results returns to the list without it.

## Unavailable (visible, inert, announced as "…, not available in this prototype")

- **Bottom bar:** Favorites, Post, Account and Chat. They are greyed, and announced as "outside this prototype".
- **Search and actions:** Save search, Saved searches, Contact seller, Open in Maps, the Newest sort, and voice search.
- **Filters:** unavailable on Home, browsing and Any-price results.
- **Expand map:** unavailable after a seller or mileage filter.
- **Location and distance pills:** shown at full opacity in the applied style with a caret, but the pickers aren't built.
- **Price pill after a seller or mileage filter:** changing the price isn't built.
- **Other category rows and the "Mid-century dresser" recent search:** other categories aren't built.

These are intentionally not built: listing-to-listing navigation, the More menu, sort options, model-year and make/model filters, and gallery photos 2–6.

## Simulated

- **Network:** latency (0.6 s normally, 3 s slow) and a single failure.
- **Removed listing:** controlled by the reviewer toggle.
- **Map:** the static metro image, with approximate neighbourhood positions. Home zooms out (to 60% at most) to fit the 25-mile circle; list and map use the handoff scale.

## Remaining limitations

- **Pill order on browsing:** the Figma browsing frame starts with Cars & trucks; the spec's order (location, radius, category) is used.
- **Typed queries:** they still work, as in earlier versions, along with the "cars" shortcut, though the spec only requires the recent "Volkswagen Golf" row and the Search key. Home's placeholder stays "Try searching 'cars'" from an earlier request; Figma Home shows "What are you looking for?".
- **Marker positions:**
  - L07 and L08 share L04 and L05's Richfield and Bloomington points, so they cluster as specified.
  - L02 (Edina) sits slightly west of its earlier estimate, so it shows as its own $13,900 marker instead of joining that cluster.
- **Not tested on a real iPhone.** Safe areas and the on-screen keyboard were checked in emulation only.
