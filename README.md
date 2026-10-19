# Craigslist iOS redesign: browser prototype

## Version control

| | |
|---|---|
| Repository | <https://github.com/rockysahooart/craigslist-livefront-prototype> |
| Branch | `main` (the only long-lived branch) |
| Live site | <https://rockysahooart.github.io/craigslist-livefront-prototype/> |
| Deployment | GitHub Pages, "Deploy from a branch": `main`, root folder. Every push to `main` publishes within about a minute. There's no build step. |

**Release history** (newest first; each row is one commit on `main` and one published version)

| Date | Version | What changed |
|---|---|---|
| 2026-10-19 | `bfcfbb7` | Location, Proximity, Sort and Filters panels. Location takes a city or ZIP code from the supported list; Proximity previews the radius on a map; both edit a draft until Apply. Sort offers Newest and both price orders. Filters adds price, Cancel and a note for listings missing a detail. Shared focus, scrolling and safe-area behaviour. |
| 2026-10-19 | `05bb209` | Fully functional filtering. Location and proximity pickers, price range, seller type, vehicle year, mileage, and make and model, all on one shared filter state with sort. Real distance filtering, validation, no-match recovery, and listing navigation over the filtered set. |
| 2026-10-19 | `df98ccd` | Aligned with the prototype update handoff: Filters sheet, edge states (loading, slow, failure, missing data, removed listing), and the Save star. |
| 2026-10-14 | `2eedfd5` | True-scale search-radius circle on every map state; circle-only Home. |
| 2026-10-14 | `6381882` | Draggable results sheet, map previews and clusters. |
| 2026-10-14 | `da1f313` | First version of the prototype. |

**Working with it**

```bash
git clone https://github.com/rockysahooart/craigslist-livefront-prototype.git
```

- **Preview a change locally:** run `python3 -m http.server 8000` and open <http://localhost:8000>.
- **Publish:** commit to `main` and push.
- **Roll back:** `git revert <commit>` on `main`, then push. Pages republishes the earlier behaviour without rewriting history.
- **Look at an older version:** `git checkout <commit>` and serve it locally.

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

## Filtering

**One shared filter state.** It drives the list, the result count, the map markers, the marker previews and listing navigation ("Listing x of y" with Previous/Next). It combines:
- the query
- location and proximity (straight-line distance from the selected search centre to each listing's coordinates)
- category
- price range
- seller type
- and, in Cars & trucks only, vehicle year, mileage, and make and model

…with the sort order (Newest, price low → high, price high → low).

| Control | Where | Behaviour |
|---|---|---|
| Location | Pill → sheet | Shows the current search location (Minneapolis 55401 to start). Type a city or ZIP code to narrow the list of supported centres: Minneapolis 55401, St. Paul 55102, Edina 55424, Bloomington 55420. A full supported ZIP code selects its city; other cities and ZIP codes are explained as unavailable. Apply re-centres the map, circle, list and markers. It never asks for or implies the device's location |
| Proximity | Pill → sheet | 5, 10, 25, 50 miles. A map preview shows the draft circle around the search centre, with listing dots inside and outside it and the count. Apply resizes the map circle at true scale and updates the list, count and markers together |
| Sort | Menu button → menu | Newest (posting time), Price: low to high, Price: high to low. The current option has a checkmark; choosing one applies it and closes. Query and filters are unchanged |
| Category | Pill → picker | All categories, All for sale, and each for-sale category. Sections with subcategories aren't built |
| Price range | Pill → price sheet, and in Filters | Minimum and maximum, inclusive; min > max is blocked with an inline error. × removes only the price |
| Seller type | Filters | All · Owner · Dealer. Listings with no stated seller are hidden while it's on |
| Vehicle year | Filters (Cars & trucks) | From/To, inclusive, 1990–2026; out of range or From > To is blocked. Unknown year never matches |
| Mileage | Filters (Cars & trucks) | Any · Under 100,000 mi (strict: exactly 100,000 doesn't match). Unknown mileage never matches |
| Make and model | Filters (Cars & trucks) | Make lists the makes in the data. Model is disabled until a make is chosen, and changing make resets an incompatible model |

**Drafts and Apply**
- Location, Proximity, Price and Filters each edit a draft. Apply commits it; Cancel, Close, Esc or the scrim discards it, and the results and their scroll position stay as they were.
- Apply previews the outcome from the draft ("Search St. Paul · Show 12 results", "Use 10 miles · Show 7 results", "Show N results").
- Clear all resets the Filters draft (price included). Clear price resets only the price draft. Neither applies anything until Apply, and neither touches location, category or query.
- Filters names the listings hidden only because a detail isn't stated, for example "1 listing without mileage".
- Leaving Cars & trucks drops the vehicle-only filters and keeps seller type and price.

**Filters (n)** counts price, seller type, year, mileage, and make/model (make and model together count as one). Location, proximity and category are never counted. An "Also filtered: …" line lists the sheet filters that are on.

**No matches** keeps the query and pills visible, explains why, and offers the paths that apply: Remove price filter, Edit filters (opens the sheet with the applied values), Clear filters, Change distance, or Edit search.

**Home rule:** before a category or query is chosen, the map shows only the proximity circle.

**Panels (shared behaviour)**
- One panel at a time. On phones the sheets sit on the bottom edge with safe-area spacing; on desktop they stay inside the contained phone.
- Long sheets scroll, and the Clear/Cancel/Apply footer stays in view, above the keyboard on phones.
- Focus moves into the panel, Tab stays inside it, the results behind are inert, and focus returns to the trigger. Every field has a label.
- Location, Proximity and Filters open from Home, browsing and results, in list and map view. Sort opens from the list header.

**Where the panels come from**
- **From Figma:** the Filters sheet (4d: seller type, mileage, Clear all, Close, Apply), the Price sheet, the Category Row, the Sheet Surface, the Price Input, the Primary and Text Buttons, and the Menu Button.
- **Extended:** Figma notes that the location and radius pickers and the sort options are not designed. Location (city/ZIP field and supported list), Proximity (map preview), the Sort menu options, the price, year and make/model sections in Filters, and the Cancel button are built from those components.

## Sample data (fictional)

All listings, years, makes, mileage, sellers and coordinates are fictional sample content, not verified seller information. Year, make and model come from each title. Map coordinates and search centres are illustrative points on the supplied metro map.

| ID | Listing | Price | Mileage | Seller | Area | Notes |
|---|---|---|---|---|---|---|
| L01 | 2016 VW Golf | $8,900 | 92,000 | Owner | Northeast | |
| L02 | 2019 VW Golf SE | $13,900 | 41,000 | Dealer | Edina | no photo |
| L03 | 2015 VW Golf | $7,500 | 112,000 | Owner | St. Paul | |
| L04 | 2017 VW Golf | $9,600 | 98,000 | Dealer | Richfield | |
| L05 | 2014 VW Golf | $6,800 | 128,000 | Owner | Bloomington | |
| L06 | 2018 Honda Civic | $12,500 | 78,000 | Dealer | St. Paul | |
| L07 | 2015 Subaru Outback | $9,800 | 104,000 | Owner | Richfield | |
| L08 | 2017 Toyota RAV4 | $14,900 | 105,000 | Dealer | Bloomington | |
| L09 | Mid-century dresser | $240 | — | not stated | Northeast | furniture |
| L10 | 2013 Ford Focus | $5,900 | not listed | Owner | Uptown | added: unknown mileage |
| L11 | 2016 VW Jetta | $8,400 | 100,000 | Dealer | Roseville | added: mileage boundary |
| L12 | 2012 Honda Accord | $10,000 | 150,000 | Owner | Maple Grove | added: price boundary |
| L13 | Toyota Tacoma pickup | $11,500 | 140,000 | Owner | Blaine | added: year not listed |

All are within 25 miles of Minneapolis. "Volkswagen Golf" still gives 5 at Any price, 4 at a $10,000 maximum, and none at $5,000.

## Also working

- **Search:** search entry, recent searches, and the "cars" shortcut.
- **Map:** list/map sheet (drag, tap, keys), markers and clusters, previews.
- **Details:** Save star, "Photo 1 of 6", "Not provided" facts, filled pickup area. Returning restores the screen, view, selected marker, list and filter-row scroll, and all applied filters.
- **States:** first-load skeleton, slow and failed price apply with Retry, removed listing.

## Unavailable

- **Bottom bar:** Favorites, Post, Account and Chat. They're greyed and announced as "outside this prototype".
- **Actions:** Save search, Saved searches, Contact seller, Open in Maps, voice search.
- **Category picker:** sections with subcategories.

## Verification

| Suite | Result |
|---|---|
| Panel suite (Location, Proximity, Sort, Filters), at 430 × 932 (mobile, touch) and 1440 px desktop | 170 of 170 checks pass |
| Filter suite, same two sizes | 188 of 188 checks pass |
| Earlier update-handoff suite | 159 of 173 pass |

**Filter suite.** Each case asserts the expected listing IDs computed from the data, not only what the app reports. It covers:
- exact price and mileage boundaries
- year ranges, including unknown years
- validation
- make/model resets
- Apply versus Close, Esc and scrim
- Clear all, and price ×
- the Filters (n) count
- sort combined with filters
- proximity checked against computed distances
- matching cards, count, markers, preview and listing navigation
- returning from details
- no matches with Edit filters and Clear filters
- vehicle-only filters outside Cars & trucks
- sheet layout, labels and keyboard access

**Earlier suite.** The 14 failures assert behaviour this pass replaced on purpose:
- the fixed four-card browse set
- no price pill on Home and browsing
- no listing navigation
- Filters unavailable on Any-price results
- a caret instead of × on price after seller or mileage filters

## Remaining limitations

- **Controls not in Figma:** vehicle year, make and model, and the location and distance pickers have no designs. They reuse the Price Input, Filter Control, Category Row and segmented-control components and are labelled as added.
- **Location coverage:** only the four sample centres resolve. There's no geocoding, and the device's location is never used.
- **Mileage options:** mileage offers only the designed "Under 100,000 mi". There's no free-entry maximum.
- **Map:** the static image can't be panned or zoomed by hand. Distances are straight lines between illustrative points.
- **Typed queries:** they search titles; there's no fuzzy matching.
- **Not tested on a real iPhone.**
