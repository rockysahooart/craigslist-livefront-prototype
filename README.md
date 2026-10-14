# Craigslist iOS redesign: browser prototype

A static HTML/CSS/JavaScript prototype of the Craigslist iOS **Search** experience: Home → category browsing → search → results → filtering → item details → return. Visual source: the original frames on the Figma page **START HERE · Final submission** (file `uBDKd4xLS50msiung2aDGJ`), with behaviour from `10 · Implementation handoff.pdf`.

- **Desktop:** the app runs inside a contained 430 × 932 pt phone, centred. Short reviewer notes beside it cover sample content, the illustrative map, the sheet gestures and what's out of scope.
- **Phone (≤ 520 px wide):** the app fills the screen. It uses the device's safe areas and keyboard, with no simulated status bar, Dynamic Island or annotations.

Favorites, Post, Account, and Chat are outside this prototype.

## Run locally

```bash
python3 -m http.server 8000
```

Open <http://localhost:8000>. To try it on a phone on the same Wi-Fi, run `python3 -m http.server 8000 --bind 0.0.0.0` and open `http://<computer-IP>:8000`.

## Deploy to GitHub Pages

Push this folder to a repository root. Then go to **Settings → Pages → Deploy from a branch → `main` / root**. Paths are relative, the font is self-hosted, and there is no build step (`.nojekyll` included).

## Files

```
index.html          page shell and app root
css/app.css         Figma tokens, materials, layout, supporting-state styles
js/data.js          sample listings (F4), locations, distances, sorts, filters, recent-search seed, categories
js/app.js           one store; screens, sheets, menus, search, filters, sort, map, details, persistence
assets/             Figma exports (icons, photos, logo, maps), Inter font (OFL)
```

## Working interactions

Everything below runs on the sample data. Search, filters, sorting, result counts, the map and the details stepper all read from one query, so they always agree.

| Area | Interactions |
|---|---|
| **Results sheet** | One sheet for Home, browsing and results, with three positions: **collapsed** (map with a compact summary, M1), **half** (map and listings, S01's 448 pt) and **expanded** (list, S03/S06's 147 pt). Drag it from the grabber or the sheet header with mouse or touch; it snaps to the nearest position, and a quick flick moves one position. Tapping the grabber cycles collapsed → half → expanded → collapsed. The grabber is a labelled button: Enter or Space activates it, and the up and down arrow keys resize. Listings scroll inside the sheet without moving it, and the page never scrolls. Expand map / Collapse map jump between list and map. |
| **Category** | Picker from any list (S02/S04/S15/S16). Every row can be selected. Cars & trucks (20 listings) and Furniture (1) have sample data; the rest show the empty state. The applied chip's × returns to All categories (Home). |
| **Search** | Search field and mic on Home and browsing. The empty field reads "Try searching ‘cars’" in All categories and "Search <category>" inside a category. Its accessible name is always "Search listings", kept separate from the placeholder. Real typing with the device keyboard; Return/Search submits. The clear (×) in the field. Cancel and Esc discard typed text. Home searches all categories; browsing searches within the category. "Volkswagen" = "VW". |
| **Results field ×** | Clears the query and returns to the category list (or Home), keeping location, distance, price and filters. |
| **Category shortcut** | Typing **cars** (also car, truck, trucks, "cars & trucks"; any case) opens Cars & trucks browsing with all 8 vehicle listings, instead of a title search. Location, distance, price and filters are kept. Other words search titles as before. |
| **Recent searches** | **Cars** (added; same as typing "cars"), the five designed rows, and your own searches (up to 8, stored in this browser). Each row re-applies its stored scope; for example, Honda Civic restores "Up to $12,000". **Clear** empties the list. |
| **Location and distance** | The Minneapolis pill offers 4 areas, and the 25 miles pill offers 5 / 10 / 25 / 50. Changing either re-centres the map, redraws the radius circle and re-runs the list. |
| **Price** | Price sheet from any list: real numeric fields, Clear price, Apply, Close / Esc / scrim (all discard the draft). Applied as "Up to $X", with × to remove. The filter row scrolls to the applied price (S09). |
| **Filters** | Filters / Filters (n) opens price, seller (Owner/Dealer) and mileage (vehicles). The button previews the matching count ("Show 3 results"). Reset filters; applied seller and mileage appear as removable chips. |
| **Sort** | The Newest menu: Newest, Closest, Price low → high, Price high → low. Full keyboard support: arrows, Enter, Esc. |
| **Filter row** | Order everywhere: **Location → Category → Distance → Price**, then any applied seller or mileage chips. Browsing shows the category as the applied chip. Scrolls horizontally (touch, trackpad, or keyboard focus). |
| **Save search** | Toggles "Search saved" (the designed active state) and persists. Home's **Saved searches** lists them; tap to run, × to remove. |
| **Listings** | Every card opens details. |
| **Details** | Scrolls; content clears the contact bar by 24 pt. Swipe or tap dots between photos. Previous / Next steps through the originating result set ("Listing 2 of 4"). The bookmark saves the listing (persisted). More → Share listing (system share sheet) or Copy link (`#listing=L03` reopens it). Open in Maps opens Apple Maps for the approximate area. Contact seller opens a simulated handoff. Close / Esc returns to where you were. |
| **Map** | Shows exactly the current results; queries, filters, distance and location update the list and the markers together. Overlapping markers group into numbered clusters. Tapping a price marker highlights it and shows its preview in the sheet: photo or placeholder, title, price, mileage and neighbourhood. The static map shifts so the marker stays visible above the sheet. Tapping a cluster opens a panel listing its listings. Preview → details → back restores the marker, the sheet position, query, filters and list position. Preview ×, Esc or tapping the map deselects. |
| **No results** | S18's layout with one recovery button for the most restrictive setting: price → other filters → distance (to 50 miles) → category (to all) → edit search. |
| **Return context** | Details, search Cancel and sheet Close restore the screen, list scroll, filter-row position, query, filters, sort, view (list or map) and map selection. |
| **Bottom bar** | Search is current; tapping it scrolls the list to the top. |
| **Accessibility** | Every control has a real button, input or link with a label, keyboard access and a 2 pt purple focus ring. Sheets are modal: the background is inert, Esc closes, and focus returns to the trigger. Counts are announced. Reduced motion and Reduce Transparency are respected. |

## Outside scope

**Favorites, Post, Account, Chat.** They stay in their designed positions, greyed and at 45% opacity with readable labels. They use `aria-disabled="true"` and are announced as "…, outside this prototype". They are not in the tab order and do nothing when tapped. No other control is disabled.

## Simulated behaviour

- **Contact seller.** A composer sheet whose own copy states "Sample listing: messages aren't sent". Sending shows "Message not sent". Nothing is stored or transmitted.
- **Map.** The supplied static metro image at the handoff scale (0.5104 pt per image px; 25 miles = 571.6 px). Marker and area positions are approximate neighbourhoods (F4). There is no pan or zoom, and no "Search this area".
- **Locations.** Minneapolis 55401 comes from F4. St. Paul 55102, Edina 55424 and Bloomington 55420 are approximate centres on the same map. Distances are straight-line measurements on that image. Your device location is never requested.
- **Voice search.** Uses the browser's speech recognition when available (Chrome, Safari). Otherwise the mic opens the search field, where the keyboard's own dictation works.
- **Persistence.** Saved listings, saved searches and recent searches live in this browser's localStorage. Clear the site's data in the browser to start fresh.

## Supporting states added

These close gaps where the handoff named a core interaction but no state was drawn. Each reuses an existing component, and none of the drawn screens were redesigned.

| Added | Built from |
|---|---|
| **Location and Distance sheets** | Sheet surface + Category Row (91:943), selected row with checkmark |
| **Filters sheet** | Price Input (95:1064) + applied Filter Control (14:185) as radio chips + Text Button "Reset filters" (the component's default label) + Primary Button |
| **Applied seller and mileage chips** | Applied Filter Control with separate edit and 44 × 44 remove targets |
| **Sort menu and More menu** | Pull-down from Menu Button (14:219) / Glass Icon Button; glass surface |
| **Saved searches sheet** | Recent Search Row (14:234) with the saved-search icon and a remove target |
| **Contact handoff sheet** | Sheet surface, listing summary, text field, Primary Button |
| **Search saved** state | Quiet Action active state described on 65:822 (purple semibold label, filled icon) |
| **Saved listing** state | Save Toggle "Saved" described on 59:650 (filled bookmark) |
| **Price range error** | Footnote under the fields, "Minimum is higher than maximum."; Apply waits until it's fixed (F5 #3) |
| **Other empty states** | S18's layout and recovery button (see No results above) |
| **Details for other listings** | S12's layout, F4 fields only (see Data rules below) |
| **Map clusters and cluster panel** | Map Cluster Marker (107:2820) with a selected state; the panel stacks Map Listing Previews (107:2824) |
| **Preview inside the sheet** | Map Listing Preview (107:2824), moved from above the sheet (M2) into it |
| **Half-height and draggable sheet** | Sheet Grabber note (14:242): "tapping cycles detents; must be exposed to VoiceOver"; positions from F4 and M1 |

The derived icons `bookmark-fill.svg`, `saved-search-fill.svg` and `search-center.svg` are the Figma exports with the fill switched on, or (for the centre mark) split out.

## Data rules

- **Listings.** L01–L09 come from F4: titles, prices, mileage, seller, hours, areas and map positions. L06–L09 map positions are derived from their F4 neighbourhoods. **L10–L21** are added sample vehicles so Cars & trucks has 20. They are placed on the supplied map's own town labels (Maple Grove, Blaine, Anoka, Shakopee, Burnsville, Apple Valley, Cottage Grove, Prior Lake, Lakeville), plus estimates for Uptown, Roseville and Woodbury, all within 25 miles of 55401. They have no photos, so they show the designed "No photo" placeholder, and their details show only their sample fields.
- **Newest order.** An exact posting minute breaks ties within each displayed hour. It reproduces the drawn orders: Home Golf then dresser (S01), browsing Golf then Civic (S03), and the S06/S09 Golf orders.
- **Expected counts (F4).** "Volkswagen Golf" → 5, max $10,000 → 4, max $5,000 → 0.
- **Seller-provided text.** Only the 2016 VW Golf has it (frame 18:501); it is kept verbatim. Other listings show only F4 fields: mileage or details, seller, posted time and area. Nothing is invented: no condition, description or availability claims.
- **Photos.** Photo counts reflect the photos that exist. The Golf has 2: the gallery image and the card image. The designed "Photo 1 of 6" (F5 #5) can't be honoured until photos 2–6 exist.

## Decisions resolved, and still open

**Resolved from the F5 list, using handoff information:**

| F5 item | Resolution |
|---|---|
| #1 Home search and cards | Wired, searching all categories |
| #2 Results field clear | Clears the query |
| #3 Price validation | Digits only, plus a range error |
| #4 Listing count | Real position in the result set |
| #6 Map entry | From any browsing or results list |
| #7 Other categories | Selectable |
| #8 S17 Search | Runs the real query |
| #10 Location, radius, Filters form, sort | Built as supporting states |

**Still open for the designer:**
1. **Home radius overlay.** S01 draws the circle at 233 pt, off the 55401 point, unlike every other screen. It is kept as drawn only at the default location and distance; any other setting uses the computed circle.
2. **Marker anchoring.** M1 puts the Golf marker above its point and the $7,500 marker centred on its point. The prototype puts all price markers above their point for consistency, so the $7,500 marker sits about 22 pt higher than in M1.
3. **Filter-row order** (F5 #9): resolved by direction. Location → Category → Distance → Price on every screen. This differs from S01, S06, S09 and S18, which put distance before category, and from S03, which starts with the category.
4. **Subcategories.** Chevron rows (More for sale, Housing, Jobs, …) open the whole section; no subcategory lists are designed.
5. **Price pill wording** for a minimum only or a range: "From $X", "$X–$Y".
6. **Sheet positions.** Collapsed, half and expanded use the drawn M1, S01 and S03 positions. Home and S03 frames don't show markers; the prototype shows them whenever the map is visible.
7. **Missing assets** (F5): L01 gallery photos 2–6 (the card photo currently stands in as photo 2), photo and map licences, map attribution, target iPhone model and iOS version.

## Verification

- **Sheet and map run: 63 of 63 checks passed.** It covers grabber tap, Enter/Space and arrow keys, mouse and touch dragging with snap and flick, list scrolling without moving the sheet, list/map/count agreement under queries and filters, marker → preview → details → return, cluster panels, details for all 21 listings, desktop containment, and phone safe areas at 390 × 844 and 375 × 667.
- **Automated end-to-end run: 75 of 75 checks passed, plus 21 of 21 for the Cars recent search, the cars shortcut, filter order, placeholder and label.** It uses headless Chrome with real clicks and typing at 1400 × 1000 (desktop), 390 × 844 and 375 × 667 (touch phone emulation). It covers:
  - search and browse
  - Apply, Cancel and remove for price and filters, plus the range error
  - all four sorts
  - location and distance changes
  - recents with stored scopes
  - save search and listing, persisted across a reload
  - details stepper and return
  - map selection, clusters and return
  - every empty-state recovery path
  - simulated contact
  - keyboard menus, Esc behaviour and the focus ring
  - the disabled bottom-bar destinations
  - on phones: viewport fit with no horizontal scroll, the contact bar pinned to the bottom, sheets above the bottom edge with the background inert, and no page errors
- **Visual comparison.** Captured at 430 × 932 against the Figma frames. S01, S06, S09, S12, S18, S19 and S20 were reviewed side by side, and they line up in layout, type, spacing, colour and materials. The known differences:
  - no illustrated keyboard on S05, S07, S08 and S17, so the price sheet rests at the bottom, as in S10
  - Home and browsing lists now hold every matching listing, not just the 2 and 4 drawn
  - the $7,500 marker position (open item 2)

## Remaining limitations

- **Not tested on a real iPhone or in Safari.** Keyboard avoidance uses `visualViewport` and the `interactive-widget` viewport hint. Bottom sheets and the contact bar should be checked against the real iOS keyboard before review.
- **Browser Back isn't wired.** In-app state isn't in the URL, apart from shared `#listing=` links, so a reload starts at Home. Saved and recent items survive the reload.
- **The map is a static image:** it doesn't pan or zoom by gesture (it only shifts to keep a selection in view), and there's no real geocoding or routing.
- **Twelve of the 20 vehicles have no photos** (sample data), so they show the "No photo" placeholder.
- **Share and Copy link** depend on browser permission. Copy link may silently fail when the page is opened from `file://`.
