# Craigslist iOS redesign: browser prototype

A static HTML/CSS/JavaScript prototype of the Craigslist iOS car-shopping redesign. It's a 430 × 932 pt iPhone screen, built from the handoff and the Figma file `uBDKd4xLS50msiung2aDGJ`.

**Live prototype:** <https://rockysahooart.github.io/craigslist-livefront-prototype/>. Open it on a phone for the full-screen version.

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
| 2026-10-19 | `cd5af24` | Interactive map: Leaflet with OpenStreetMap tiles, a geographic proximity circle, pan, pinch and button zoom, Reset map, and markers at their coordinates. Minneapolis and 25 miles as the default search area. Returning-to-a-car-search concept: save search, alerts, Continue your search, and new-match and price-drop example notifications. README rewritten for the current build. |
| 2026-10-19 | `2517634` | Network simulation with one request lifecycle: Slow, and Fail once then Retry works. Vehicle photos replaced with AI-generated everyday-listing photos. L10–L13 got photos, and L01 shows Photo 1 of 1. |
| 2026-10-19 | `bede9be` | Shorter desktop prototype notes. |
| 2026-10-19 | `bfcfbb7` | Location, Proximity, Sort and Filters panels with drafts, Cancel and Apply. |
| 2026-10-19 | `05bb209` | Fully functional filtering on one shared filter state. |
| 2026-10-19 | `df98ccd` | Aligned with the prototype update handoff: Filters sheet, edge states and the Save star. |
| 2026-10-14 | `2eedfd5` | True-scale search-radius circle on every map state; circle-only Home. |
| 2026-10-14 | `6381882` | Draggable results sheet, map previews and clusters. |
| 2026-10-14 | `da1f313` | First version of the prototype. |

**Working with it**

```bash
git clone https://github.com/rockysahooart/craigslist-livefront-prototype.git
```

- **Publish:** commit to `main` and push.
- **Roll back:** `git revert <commit>` on `main`, then push. Pages republishes the earlier behaviour without rewriting history.
- **Look at an older version:** `git checkout <commit>` and serve it locally.

## Run locally

```bash
python3 -m http.server 8000
```

Open <http://localhost:8000>. Any static file server works. It uses relative paths and has no build step and no API keys. It needs internet access for the Leaflet library (cdnjs) and the map tiles (OpenStreetMap). Without them the map shows an explanation, and the listings keep working.

- **Phone (≤ 520 px wide):** full screen, app-like. It uses the device's safe areas and keyboard, with no simulated status bar or annotations.
- **Desktop:** the app sits in a contained 430 × 932 pt phone. Beside it are short prototype notes, the saved-search demo controls and the simulated network conditions.

## Features and working flows

**Default search area.**
- Every fresh load starts at Minneapolis (ZIP 55401) with a 25-mile radius. The pill, map, circle, listings and distances all use it.
- The prototype never asks for location permission, shows no location onboarding, and doesn't use device or IP location.
- Location changes during the session are respected. "Reset demo" and "Restart from Home" return to Minneapolis and 25 miles.

**Discovery journey.**
- **Home:** the map shows the proximity circle only, with no markers.
- **Search:** the search field has recent searches and the "cars" shortcut.
- **Category browsing:** each for-sale category works on the sample data.
- **Results:** a two-state results sheet. Drag the grabber or header, tap the grabber, or use Expand map / Collapse map.
- **Map view:** markers and clusters, a preview for the selected listing, and details.
- **Details:** Save star, photo counter, "Not provided" facts, pickup area, and Previous/Next across the filtered results.
- **Returning:** closing details restores the screen, view, selection, scroll, filters and the map position.

**Filtering: one shared filter state.** It drives the list, the result count, the map markers, the previews and listing navigation. It combines:
- the query
- location and proximity (straight-line distance from the search centre)
- category
- price range
- seller type
- in Cars & trucks, vehicle year, mileage, and make and model

Sort reorders the results: Newest, Price: low to high, Price: high to low.

| Control | Where | Behaviour |
|---|---|---|
| Location | Pill → sheet | Shows the current search location. Type a city or ZIP code to narrow the supported centres: Minneapolis 55401, St. Paul 55102, Edina 55424, Bloomington 55420. Anything else is explained as unavailable. Apply re-centres the map, circle, list and markers |
| Proximity | Pill → sheet | 5, 10, 25 or 50 miles, with a preview of the draft circle and count. Apply updates the circle, list, count and markers together |
| Sort | Menu button | Newest, Price: low to high, Price: high to low. The current option has a checkmark; choosing one applies it |
| Category | Pill → picker | All categories, All for sale, and each for-sale category. Sections with subcategories aren't built |
| Price range | Pill, or in Filters | Minimum and maximum, inclusive. Min > max is blocked with an inline error. × removes only the price |
| Seller type | Filters | All · Owner · Dealer |
| Vehicle year | Filters (Cars & trucks) | From/To, inclusive, 1990–2026. An unknown year never matches |
| Mileage | Filters (Cars & trucks) | Any · Under 100,000 mi (strict). Unknown mileage never matches |
| Make and model | Filters (Cars & trucks) | Model is disabled until a make is chosen. Changing make resets an incompatible model |

**How the filter panels behave**
- **Drafts:** sheets edit a draft. Apply commits it; Cancel, Close, Esc or the scrim discards it. Apply previews the outcome ("Show N results").
- **Filters (n) count:** counts price, seller, year, mileage and make/model. "Also filtered: …" lists the active sheet filters.
- **No matches:** the query and pills stay visible, with an explanation and the recovery actions that apply.
- **One panel at a time:** each sits on the bottom edge with safe-area spacing, scrolls when it's long, and keeps its footer above the keyboard.
- **Focus:** focus moves into the panel, Tab stays inside it, and focus returns to the control that opened it.

**Returning to a car search (exploratory concept, not validated).** Built from the Figma section "Exploration · Returning to a car search" (R0–R11), and labelled as a concept in the desktop notes.
- **Save search:** saves the query, category, location, radius and every applied filter. New-match alerts are optional (Off, Daily, Weekly); declining still saves. A "Search saved" confirmation offers Manage.
- **Continue your search:** a Home entry for the most recent saved search, with "n new" since it was last viewed. Selecting it restores the search; viewing resets the count.
- **New-match alert:** an example notification opens the saved results, with "1 new since …" and the new card marked "New".
- **Price-drop alert:** saving a listing (star) offers price-drop alerts. The example notification opens the same listing at its new price, inside its saved search. The card then shows "Price lowered from $8,900".
- **Manage:** change the frequency, pause alerts (Off), or remove the saved search.
- **Removed listing:** shows "This listing was removed by the seller" with "See matching results".
- **Storage:** saved searches, price-drop alerts and demo events persist in `localStorage`, separate from saved listings.
- **Notifications are in-app examples only.** Nothing monitors in the background, nothing is pushed or emailed, and no notification permission is requested.

## Map provider, configuration and attribution

| | |
|---|---|
| Library | [Leaflet](https://leafletjs.com) 1.9.4, loaded from cdnjs (`leaflet.min.js` / `leaflet.min.css`) |
| Tiles | OpenStreetMap standard raster tiles, `https://tile.openstreetmap.org/{z}/{x}/{y}.png` |
| Credentials | None: no API key, token or account |
| Attribution | "© OpenStreetMap contributors", linked to the OSM copyright page. Shown on the map just above the sheet |
| Usage terms | The [OSM tile usage policy](https://operations.osmfoundation.org/policies/tiles/) allows light use like a prototype, with attribution. There's no uptime guarantee and heavy traffic isn't allowed. For production, switch to a commercial or self-hosted tile provider; it's one URL in `initMap()` in `js/app.js` |

**How the map works**
- **One instance:** the map lives in `#map-layer`. It's created once and is never rebuilt by screen renders.
- **View only:** panning (one finger or click-drag), pinch, wheel and the + / − buttons change the view only, never the applied search.
- **Reset map:** frames the applied search area between the filter row and the sheet. The view also re-frames when a new location or radius is applied.
- **Proximity circle:** a Leaflet `L.circle` in metres, for example 25 miles = 40,233.6 m. It has the purple 1.5 pt outline and subtle fill, is centred on the selected search location, and scales correctly with zoom.
- **Search centre:** the centre mark is the search location, not the buyer's position.
- **Markers:** they use the existing sample coordinates. Labels that would overlap at the current zoom merge into clusters.
- **Home rule:** Home before a category or query shows the circle only.
- **Gestures and layers:**
  - The exposed map pans and zooms.
  - The sheet grabber moves the sheet, and sheet content scrolls the list.
  - Filter pills stay tappable above the map.
  - The top edge blur doesn't block gestures.
  - The page itself never moves.
- **Coordinates:** the sample coordinates were drawn on the supplied metro image. They're placed on the real map by anchoring ZIP 55401 at 44.9855, −93.2690 and using the image's scale (22.86 px per mile). They remain illustrative points, not addresses. Distances are great-circle miles, the same geometry as the circle.
- **If tiles fail:** "Map didn't load. Map tiles couldn't be reached. The list still works." with Retry. If the Leaflet script can't load, the map area explains it, and the listings still work.

## Network simulations and demo controls

**Simulated network conditions.** These are under the desktop notes. On a phone, use URL parameters.

| Scenario | Desktop | Phone URL |
|---|---|---|
| Normal (about 0.65 s per search) | "Normal" | none |
| Slow: "Finding listings…" with skeletons, then after 2.5 s "Taking longer than usual · Your search is still running", then results at 6 s | "Slow" | `?network=slow` |
| Fail once, then Retry works: "Couldn't load listings · Your search and filters are saved." with Retry. Retry shows loading, then the same search. Choosing it again re-arms it | "Fail once, then Retry works" | `?network=fail` |
| Removed listing (2016 VW Golf) | checkbox | `?removed=L01` |

- **What waits for a response:** every search (first load, search, category, location, distance, price, filters). Sort reorders the loaded results instantly.
- **While waiting:** no count, "0 results" or markers are shown.
- **Newer search wins:** a newer search cancels the older request, and late responses are ignored.

**Saved-search demo (simulated).** These buttons are under the desktop notes.
- **"New listing matches":** adds L14, a 2015 VW Golf in Golden Valley. A saved search it matches, with alerts on, shows the example notification.
- **"Price drop on 2016 VW Golf":** lowers L01 from $8,900 to $8,500. If the listing is saved with price-drop alerts on, the example notification appears.
- **"Reset demo":** clears saved searches, alerts and demo events, and returns to Minneapolis and 25 miles.
- **On a phone:** after saving a search, add `?demo=new-match` or `?demo=price-drop`.

## Sample data and image sources

- **Fictional data:** all listings, years, makes, mileage, sellers and coordinates are fictional sample content, not verified seller information.
- **Photos:** vehicle photos are AI-generated sample images in an everyday listing style. Private sellers are in driveways and parking lots; dealers are on a plain lot. They were generated with Figma's image generation. [assets/img/SOURCES.md](assets/img/SOURCES.md) records each one.
- **One photo per listing:** each listing uses one photo for its card, map preview and details.
- **Not generated:** the dresser (L09) photo and the icons come from the Figma file. The font is Inter (SIL OFL).

| ID | Listing | Price | Mileage | Seller | Area | Notes |
|---|---|---|---|---|---|---|
| L01 | 2016 VW Golf | $8,900 | 92,000 | Owner | Northeast | $8,500 after the price-drop demo |
| L02 | 2019 VW Golf SE | $13,900 | 41,000 | Dealer | Edina | no photo (designed state) |
| L03 | 2015 VW Golf | $7,500 | 112,000 | Owner | St. Paul | |
| L04 | 2017 VW Golf | $9,600 | 98,000 | Dealer | Richfield | |
| L05 | 2014 VW Golf | $6,800 | 128,000 | Owner | Bloomington | |
| L06 | 2018 Honda Civic | $12,500 | 78,000 | Dealer | St. Paul | |
| L07 | 2015 Subaru Outback | $9,800 | 104,000 | Owner | Richfield | |
| L08 | 2017 Toyota RAV4 | $14,900 | 105,000 | Dealer | Bloomington | |
| L09 | Mid-century dresser | $240 | — | not stated | Northeast | furniture |
| L10 | 2013 Ford Focus | $5,900 | not listed | Owner | Uptown | unknown mileage |
| L11 | 2016 VW Jetta | $8,400 | 100,000 | Dealer | Roseville | mileage boundary |
| L12 | 2012 Honda Accord | $10,000 | 150,000 | Owner | Maple Grove | price boundary |
| L13 | Toyota Tacoma pickup | $11,500 | 140,000 | Owner | Blaine | year not listed |
| L14 | 2015 VW Golf | $8,400 | 101,000 | Owner | Golden Valley | appears only with the new-match demo |

## Files

```
index.html          page shell, Leaflet (cdnjs), desktop notes and demo controls, map layer, app root
css/app.css         Figma tokens, materials, layout, states, map layers
js/data.js          sample listings (one record per listing), details, recent searches, locations, categories
js/app.js           one store: screens, sheets, filtering, request lifecycle, interactive map, saved searches
assets/img/         listing photos and SOURCES.md
assets/map/         search-centre mark, marker pointer, static maps for the radius preview and pickup area
assets/icons/       icons; assets/fonts/ Inter
```

## Verification

Automated runs use headless Chrome with real taps, clicks, drags and typing. Each suite runs at 430 × 932 (mobile, touch) and 1440 px wide (desktop), and expected results are computed from the data.

| Suite | Covers |
|---|---|
| Interactive map and default location | Fresh-load Minneapolis/25 and no geolocation. One map instance. Pan, zoom buttons and Reset map. The circle's centre and geographic radius. Location and radius changes. Markers = results. Marker → preview → details → back with the view kept. Sheet drag vs list scroll vs map. Attribution, and tile failure |
| Filters | Every filter, boundaries, validation, drafts, counts, sort, proximity, recovery |
| Panels | Location, Proximity, Sort and Filters: open, edit, apply, cancel, reopen, focus, layout |
| Network | Slow (with a change mid-request), Fail once and Retry, the late-response guard |
| Images | Every vehicle photo on its card, map preview and details |
| Returning to a car search | Save (alerts declined and on), reload, resume, both alert types, manage, remove, removed listing |

The latest results for this build are in the release notes of the commit that published it.

## Unavailable (as scoped)

- **Bottom bar:** Favorites, Post, Account and Chat are greyed and announced as unavailable.
- **Actions:** the Saved searches list, Contact seller, Open in Maps, voice search.
- **Category picker:** sections with subcategories.

## Known limitations

- **Map tiles:** the OpenStreetMap tile servers are for light use only and have no guarantee; production needs a tile provider. Leaflet and the tiles need internet access.
- **Static mini-maps:** the Proximity sheet preview and the details pickup map still use the static metro image. The main map is interactive.
- **Location coverage:** only the four sample centres resolve. There's no geocoding.
- **Coordinates:** listing coordinates are illustrative, placed from the original image. They aren't addresses.
- **Mileage:** offers only the designed "Under 100,000 mi".
- **Typed queries:** they search titles, with no fuzzy matching.
- **Notifications:** in-app examples only. There's no background monitoring, push or email.
- **Saved searches:** only one appears on Home, and there's no Saved searches list.
- **Photos:** one per listing. AI-generated sample images, not real vehicles.
- **Not tested on a real iPhone.**
