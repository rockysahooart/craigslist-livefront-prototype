/* Craigslist iOS redesign — browser prototype.
   One store for all screens (handoff F1). Discovery screens (Home, browsing, results) share one map and one
   draggable results sheet with three snap positions. Sheets edit drafts until Apply. */
(function () {
  'use strict';

  const D = window.CL_DATA;
  const byId = Object.fromEntries(D.listings.map(l => [l.id, l]));
  const IMG = 'assets/icons/';
  const PX = 0.5104;                 // pt per metro-map image px (F4)
  const HOME_LOC = 'mpls', HOME_RADIUS = 25;
  const SEARCH_LABEL = 'Search listings'; // accessible name, kept separate from the placeholder
  const SNAPS = ['collapsed', 'half', 'expanded'];
  const PREVIEW_BLOCK = 134;         // in-sheet preview: 22 pt (grabber) + 112 pt card

  const appEl = document.getElementById('app');
  const screenEl = document.getElementById('screen');
  const overlayEl = document.getElementById('overlay');
  const liveEl = document.getElementById('live');
  const device = document.getElementById('device');

  // ---------- Local persistence (saved listings, saved searches, recent searches) ----------

  const store = {
    get(key, fallback) { try { const v = localStorage.getItem('cl-proto-' + key); return v ? JSON.parse(v) : fallback; } catch (_) { return fallback; } },
    set(key, val) { try { localStorage.setItem('cl-proto-' + key, JSON.stringify(val)); } catch (_) { /* private mode */ } }
  };
  let savedListings = store.get('saved-listings', []).filter(id => byId[id]);
  let savedSearches = store.get('saved-searches', []);
  let recents = store.get('recents', D.recentSeed.slice());
  if (!store.get('recents-cars-seeded', false)) {
    if (!recents.some(r => r.query.trim().toLowerCase() === 'cars')) recents = [D.recentSeed[0], ...recents].slice(0, 8);
    store.set('recents', recents);
    store.set('recents-cars-seeded', true);
  }

  // ---------- State ----------

  function emptyFilters() { return { price: { min: null, max: null }, seller: null, mileage: null }; }
  function initialState() {
    return {
      screen: 'home',          // home | browse | results (discovery) · search · details
      query: '',
      category: 'all',
      location: HOME_LOC,
      radius: HOME_RADIUS,
      filters: emptyFilters(),
      sort: 'newest',
      sheet: 'half',           // results sheet snap: collapsed | half | expanded
      pan: { x: 0, y: 0 },     // map offset that keeps a selected marker in view (static image)
      draft: null,             // sheet draft (price / filters), discarded on Close
      selectedListingId: null, // map selection
      cluster: null,           // open map cluster (key)
      details: null,           // { id, ids } — ids is the originating result set
      returnTo: null,          // context stored when details opens (F1)
      searchReturn: null,      // context stored when search entry opens
      overlay: null            // { type, focusReturn, ... }
    };
  }
  let state = initialState();

  // ---------- Helpers ----------

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = n => '$' + n.toLocaleString('en-US');
  const icon = (name, cls = '') => `<img src="${IMG}${name}.svg" alt="" class="${cls}">`;
  const $ = sel => appEl.querySelector(sel);
  const loc = (id = state.location) => D.locations.find(l => l.id === id);
  const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
  const areaName = l => l.area === 'Northeast' ? 'Northeast Minneapolis' : l.area;
  const isDiscovery = (s = state.screen) => s === 'home' || s === 'browse' || s === 'results';

  function catLabel(id) {
    if (id === 'all') return 'All categories';
    const c = [...D.categories.forSale, ...D.categories.other].find(c => c.id === id);
    return c ? c.label.replace('More for sale categories', 'More for sale') : id;
  }
  function inCategory(l, cat) {
    if (cat === 'all') return true;
    if (cat === 'all-for-sale') return D.forSaleIds.includes(l.category);
    return l.category === cat;
  }
  const vehicleScope = cat => ['all', 'all-for-sale', 'cars-trucks'].includes(cat);
  function milesFrom(l, locationId = state.location) {
    const c = loc(locationId).px;
    return Math.hypot(l.mapPx[0] - c[0], l.mapPx[1] - c[1]) / D.PX_PER_MILE;
  }
  function hasPrice(p = state.filters.price) { return p.min != null || p.max != null; }
  function filterCount(f = state.filters) { return (hasPrice(f.price) ? 1 : 0) + (f.seller ? 1 : 0) + (f.mileage ? 1 : 0); }

  // "Up to $X" is designed; minimum-only and range labels follow the same pattern (README, supporting states).
  function priceLabel(p = state.filters.price) {
    if (p.min != null && p.max != null) return `${money(p.min)}–${money(p.max)}`;
    if (p.max != null) return `Up to ${money(p.max)}`;
    if (p.min != null) return `From ${money(p.min)}`;
    return 'Any price';
  }
  const mileageLabel = m => `Under ${m.toLocaleString('en-US')} mi`;

  // Search: case-insensitive, "Volkswagen" = "VW" (F4); every typed word must start a word in the title.
  function words(s) { return s.toLowerCase().replace(/volkswagen/g, 'vw').replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean); }

  // One query for every list, map, count and details stepper, so they always agree.
  function compute(s = state) {
    const q = words(s.query);
    const { price, seller, mileage } = s.filters;
    const list = D.listings
      .filter(l => inCategory(l, s.category))
      .filter(l => milesFrom(l, s.location) <= s.radius)
      .filter(l => { const t = words(l.title); return q.every(w => t.some(tw => tw.startsWith(w))); })
      .filter(l => (price.min == null || l.price >= price.min) && (price.max == null || l.price <= price.max)) // inclusive (F4)
      .filter(l => !seller || l.seller === seller)
      .filter(l => !mileage || (l.miles != null && l.miles < mileage));
    const by = {
      newest: (a, b) => a.minutes - b.minutes,
      closest: (a, b) => milesFrom(a, s.location) - milesFrom(b, s.location),
      'price-asc': (a, b) => a.price - b.price,
      'price-desc': (a, b) => b.price - a.price
    }[s.sort];
    return list.sort((a, b) => by(a, b) || a.id.localeCompare(b.id));
  }

  function scope(s = state) {
    return { category: s.category, location: s.location, radius: s.radius, price: { ...s.filters.price }, seller: s.filters.seller, mileage: s.filters.mileage };
  }
  function normScope(sc = {}) {
    return { category: sc.category || 'all', location: sc.location || HOME_LOC, radius: sc.radius || HOME_RADIUS,
      price: sc.price ? { min: sc.price.min ?? null, max: sc.price.max ?? null } : { min: null, max: null },
      seller: sc.seller || null, mileage: sc.mileage || null };
  }
  function scopeText(sc) {
    const parts = [catLabel(sc.category), loc(sc.location).label, `${sc.radius} miles`];
    if (sc.price && hasPrice(sc.price)) parts.push(priceLabel(sc.price));
    if (sc.seller) parts.push(sc.seller);
    if (sc.mileage) parts.push(mileageLabel(sc.mileage));
    return parts.join(' · ');
  }
  // Recent Search Row: scope text only when it differs from the scope line above (component note 14:234).
  function scopeDiff(sc, cur) {
    if (sc.category !== cur.category || sc.location !== cur.location || sc.radius !== cur.radius) return scopeText(sc);
    const parts = [];
    if (JSON.stringify(sc.price) !== JSON.stringify(cur.price)) parts.push(priceLabel(sc.price));
    if (sc.seller !== cur.seller) parts.push(sc.seller || 'Any seller');
    if (sc.mileage !== cur.mileage) parts.push(sc.mileage ? mileageLabel(sc.mileage) : 'Any mileage');
    return parts.join(' · ');
  }
  const searchKey = (query, sc) => JSON.stringify([query.trim().toLowerCase(), normScope(sc)]);

  function listScreen() { return state.query ? 'results' : (state.category === 'all' ? 'home' : 'browse'); }
  const defaultSheet = (screen = listScreen()) => screen === 'home' ? 'half' : 'expanded'; // S01 · S03/S06
  function announce(msg) { liveEl.textContent = ''; setTimeout(() => { liveEl.textContent = msg; }, 30); }

  // ---------- Building blocks ----------

  // Outside this prototype (bottom-bar destinations only): kept in place, muted, inoperable, announced as disabled.
  function outsideTab(img, label) {
    return `<button type="button" class="tab is-outside" aria-disabled="true" tabindex="-1" aria-label="${label}, outside this prototype" data-action="noop">${icon(img)}<span>${label}</span></button>`;
  }
  function tabbar() {
    return `<nav class="tabbar" aria-label="Tabs">
      <button type="button" class="tab is-current" aria-current="page" data-action="tab-search" data-fid="tab-search">${icon('tab-search')}<span>Search</span></button>
      ${outsideTab('tab-star', 'Favorites')}${outsideTab('tab-plus', 'Post')}${outsideTab('tab-person', 'Account')}${outsideTab('tab-chat', 'Chat')}
    </nav>`;
  }

  // Map world: the supplied metro image at the shared scale, centred on the search location. Markers live inside
  // the world, so they stay anchored to the map when it is re-framed, panned or resized.
  function worldTops() {
    const c = loc().px;
    const dy = ((898 - c[1]) * PX).toFixed(2);
    return { list: `calc(var(--top) - 59px - 208.65px + ${dy}px)`, map: `calc(var(--top) - 59px - 78.65px + ${dy}px)` };
  }
  function mapBg(opts = {}) {
    const c = loc().px;
    const r = state.radius * D.PX_PER_MILE * PX;
    const t = worldTops();
    // Home at the default location keeps its drawn overlay (S01), except while the map is in use.
    const homeDrawn = opts.home && state.location === HOME_LOC && state.radius === HOME_RADIUS;
    const radius = `${homeDrawn ? `<img class="map-radius is-home" src="assets/map/search-radius-home.svg" alt="">` : ''}
      <span class="map-circle ${homeDrawn ? 'is-home-alt' : ''}" style="left:${(c[0] * PX - r).toFixed(2)}px;top:${(c[1] * PX - r).toFixed(2)}px;width:${(2 * r).toFixed(2)}px;height:${(2 * r).toFixed(2)}px"></span>
      <img class="map-center ${homeDrawn ? 'is-home-alt' : ''}" src="assets/map/search-center.svg" alt="" style="left:${(c[0] * PX - 9).toFixed(2)}px;top:${(c[1] * PX - 9).toFixed(2)}px">`;
    return `<div class="map-bg ${opts.home ? 'is-home' : ''}" data-action="map-bg">
      <div class="map-world" style="left:calc(50% - ${(c[0] * PX).toFixed(2)}px);--top-list:${t.list};--top-map:${t.map};--pan-x:${state.pan.x}px;--pan-y:${state.pan.y}px">
        <img class="map-img" src="assets/map/metro-map.png" alt="">
        ${radius}
        <div class="markers" role="group" aria-label="Listing markers">${opts.markers || ''}</div>
      </div>
    </div>
    <div class="map-edge"></div>`;
  }

  function pillPlain(label, { tag = false, action, fid, aria }) {
    const inner = `${tag ? icon('tag', 'ic-tag') : ''}<span>${esc(label)}</span>${icon('caret-down', 'ic-caret')}`;
    return `<div class="pill"><button type="button" class="pill-edit inset-focus" data-action="${action}" data-fid="${fid}" aria-label="${esc(aria || label)}" aria-haspopup="dialog">${inner}</button></div>`;
  }
  function pillApplied(label, { tag = false, editAction, removeAction, editAria, removeAria, fid }) {
    const inner = `${tag ? icon('tag-purple', 'ic-tag') : ''}<span>${esc(label)}</span>`;
    return `<div class="pill is-applied">
      <button type="button" class="pill-edit inset-focus" data-action="${editAction}" data-fid="${fid}" aria-label="${esc(editAria)}" aria-haspopup="dialog">${inner}</button>
      <span class="pill-divider" aria-hidden="true"></span>
      <button type="button" class="pill-remove inset-focus" data-action="${removeAction}" data-fid="${fid}-remove" aria-label="${esc(removeAria)}">${icon('xmark-pill')}</button>
    </div>`;
  }
  const pillLocation = () => pillPlain(loc().label, { action: 'open-location', fid: 'pill-location', aria: `Location: ${loc().label} ${loc().zip}. Change location` });
  const pillRadius = () => pillPlain(`${state.radius} miles`, { action: 'open-radius', fid: 'pill-radius', aria: `Distance: within ${state.radius} miles. Change distance` });
  function pillPrice() {
    return hasPrice()
      ? pillApplied(priceLabel(), { editAction: 'open-price', removeAction: 'price-remove', editAria: `Price: ${priceLabel()}. Edit price`, removeAria: 'Remove price filter', fid: 'pill-price' })
      : pillPlain('Any price', { action: 'open-price', fid: 'pill-price', aria: 'Price: Any price. Set price' });
  }
  function pillExtras() {
    const f = state.filters, out = [];
    if (f.seller) out.push(pillApplied(f.seller, { editAction: 'open-filters', removeAction: 'seller-remove', editAria: `Seller: ${f.seller}. Edit filters`, removeAria: 'Remove seller filter', fid: 'pill-seller' }));
    if (f.mileage) out.push(pillApplied(mileageLabel(f.mileage), { editAction: 'open-filters', removeAction: 'mileage-remove', editAria: `Mileage: ${mileageLabel(f.mileage)}. Edit filters`, removeAria: 'Remove mileage filter', fid: 'pill-mileage' }));
    return out;
  }
  // Order: Location → Category → Proximity → Price, then applied seller/mileage chips.
  function filtersRow() {
    const category = state.screen === 'browse'
      ? pillApplied(catLabel(state.category), { tag: true, editAction: 'open-category', removeAction: 'category-remove', editAria: `Category: ${catLabel(state.category)}. Change category`, removeAria: 'Remove category', fid: 'pill-category' })
      : pillPlain(catLabel(state.category), { tag: true, action: 'open-category', fid: 'pill-category', aria: `Category: ${catLabel(state.category)}. Change category` });
    return `<div class="filters" role="group" aria-label="Quick filters">${[pillLocation(), category, pillRadius(), pillPrice(), ...pillExtras()].join('')}</div>`;
  }

  const photoOrPlaceholder = (l, cls = '') => l.photo ? `<img src="${l.photo}" alt="" class="${cls}" loading="lazy">` : `<span class="no-photo ${cls}">${icon('photo')}<span>No photo</span></span>`;
  function cardLabel(l) { return `${l.title}, ${money(l.price)}, ${l.detail}${l.seller ? ', ' + l.seller : ''}, ${plural(l.hours, 'hour')} ago, ${l.area}${l.photo ? '' : ', no photo'}`; }
  function card(l) {
    const seller = l.seller ? `<span class="card-seller"><span>·</span><span>${l.seller}</span></span>` : '';
    return `<button type="button" class="card" data-action="open-details" data-id="${l.id}" data-fid="card-${l.id}" aria-label="${esc(cardLabel(l))}">
      <span class="card-photo">${photoOrPlaceholder(l)}<span class="price-badge">${money(l.price)}</span></span>
      <span class="card-text">
        <span class="card-title">${esc(l.title)}</span>
        <span class="card-detail"><span>${esc(l.detail)}</span>${seller}</span>
        <span class="card-meta">${l.hours} hr ago • ${esc(l.area)}</span>
      </span>
    </button>`;
  }
  const grid = list => `<ul class="grid">${list.map(l => `<li>${card(l)}</li>`).join('')}</ul>`;

  function sortBtn() {
    const label = D.sorts.find(s => s.id === state.sort).label;
    return `<button type="button" class="menu-btn" data-action="open-sort" data-fid="sort-btn" aria-haspopup="menu" aria-expanded="false" aria-label="Sort: ${label}"><span>${label}</span>${icon('caret-down')}</button>`;
  }
  function filtersBtn() {
    const n = filterCount();
    return `<button type="button" class="quiet" data-action="open-filters" data-fid="filters-btn" aria-haspopup="dialog">${icon('sliders')}<span>Filters${n ? ` (${n})` : ''}</span></button>`;
  }
  function saveSearchBtn() {
    const saved = isSearchSaved();
    return `<button type="button" class="quiet ${saved ? 'is-active' : ''}" data-action="toggle-save-search" data-fid="save-search" aria-pressed="${saved}">${icon(saved ? 'saved-search-fill' : 'saved-search')}<span>${saved ? 'Search saved' : 'Save search'}</span></button>`;
  }
  const placeholder = () => state.category === 'all' ? 'Try searching ‘cars’' : `Search ${catLabel(state.category).toLowerCase()}`;

  function searchFieldIdle() {
    return `<div class="field has-main">
      <button type="button" class="field-main" data-action="open-search" data-fid="search-field" aria-label="${SEARCH_LABEL}">
        ${icon('search', 'field-icon')}<span class="field-text is-placeholder">${esc(placeholder())}</span>
      </button>
      <button type="button" class="field-mic" data-action="voice-search" data-fid="search-mic" aria-label="Search by voice">${icon('mic')}</button>
    </div>`;
  }
  function searchFieldFilled() {
    return `<div class="field has-main has-clear">
      <button type="button" class="field-main" data-action="open-search" data-fid="search-field" aria-label="${SEARCH_LABEL}: ${esc(state.query)}. Edit search">
        ${icon('search', 'field-icon')}<span class="field-text">${esc(state.query)}</span>
      </button>
      <button type="button" class="field-clear" data-action="results-clear" data-fid="results-clear" aria-label="Clear search">${icon('xmark-circle-fill')}</button>
    </div>`;
  }

  // No-results recovery. S18 is the designed price case; other cases reuse its layout (README, supporting states).
  function emptyState() {
    const f = state.filters;
    const title = state.query ? 'No listings match your search.' : `No ${catLabel(state.category).toLowerCase()} listings within ${state.radius} miles.`;
    let text, action, label;
    if (hasPrice()) { text = 'Try increasing your maximum price or removing the price filter.'; action = 'price-remove'; label = 'Remove price filter'; }
    else if (f.seller || f.mileage) { text = 'Try removing some filters.'; action = 'filters-reset'; label = 'Reset filters'; }
    else if (state.radius < 50) { text = 'Try searching a larger distance.'; action = 'radius-50'; label = 'Search within 50 miles'; }
    else if (state.category !== 'all') { text = 'Try searching all categories.'; action = 'category-all'; label = 'Search all categories'; }
    else { text = 'Check the spelling or try different words.'; action = 'open-search'; label = 'Edit search'; }
    return `<div class="no-results">
      <h2 class="t-headline" style="margin:0" id="results-count">${esc(title)}</h2>
      <p class="t-sub c2" style="margin:0">${esc(text)}</p>
      <button type="button" class="primary-btn" data-action="${action}" data-fid="recover-btn">${esc(label)}</button>
    </div>`;
  }

  // ---------- Map markers and clusters ----------

  // Listings closer than a marker's footprint are grouped (Map Cluster Marker 107:2820) with a numbered badge.
  function markerGroups(list) {
    const groups = [];
    for (const l of list) {
      const p = { l, x: l.mapPx[0] * PX, y: l.mapPx[1] * PX };
      const g = groups.find(g => g.items.some(q => Math.abs(q.x - p.x) < 56 && Math.abs(q.y - p.y) < 40));
      if (g) g.items.push(p); else groups.push({ items: [p] });
    }
    // Merge groups that grew into each other.
    for (let i = 0; i < groups.length; i++) {
      for (let j = i + 1; j < groups.length; j++) {
        if (groups[i].items.some(a => groups[j].items.some(b => Math.abs(a.x - b.x) < 56 && Math.abs(a.y - b.y) < 40))) {
          groups[i].items.push(...groups[j].items); groups.splice(j, 1); j = i;
        }
      }
    }
    groups.forEach(g => {
      g.x = g.items.reduce((s, p) => s + p.x, 0) / g.items.length;
      g.y = g.items.reduce((s, p) => s + p.y, 0) / g.items.length;
      g.items.sort((a, b) => a.l.minutes - b.l.minutes);
      g.key = g.items.map(p => p.l.id).sort().join('-');
    });
    return groups;
  }
  function markers(list) {
    return markerGroups(list).map(g => {
      const style = `left:${g.x.toFixed(2)}px;top:${g.y.toFixed(2)}px`;
      if (g.items.length === 1) {
        const l = g.items[0].l;
        const selected = state.selectedListingId === l.id;
        return `<button type="button" class="marker ${selected ? 'is-selected' : ''}" style="${style}" data-action="marker-select" data-id="${l.id}" data-fid="marker-${l.id}"
          aria-pressed="${selected}" aria-label="${esc(l.title)}, ${money(l.price)}, ${esc(l.area)}, approximate location">
          <span class="marker-capsule">${money(l.price)}</span>${selected ? `<span class="marker-pointer"><img src="assets/map/marker-pointer.svg" alt=""></span>` : ''}</button>`;
      }
      const open = state.cluster === g.key || g.items.some(p => p.l.id === state.selectedListingId);
      return `<button type="button" class="cluster ${open ? 'is-selected' : ''}" style="${style}" data-action="cluster-open" data-key="${g.key}" data-fid="cluster-${g.key}"
        aria-pressed="${open}" aria-label="${g.items.length} listings close together. Show them">
        <span class="cluster-count t-sub-e">${g.items.length}</span><span class="t-sub-e">listings</span></button>`;
    }).join('');
  }
  function groupFor(id, list) { return markerGroups(list).find(g => g.items.some(p => p.l.id === id)); }

  // Map Listing Preview (107:2824), shown in the results sheet.
  function previewCard(l, { action = 'open-details', fid = 'preview-open', dismiss = true } = {}) {
    return `<div class="preview" role="group" aria-label="Selected listing">
      <button type="button" class="preview-main" data-action="${action}" data-id="${l.id}" data-fid="${fid}" aria-label="${esc(l.title)}, ${money(l.price)}, ${esc(l.detail)}, ${esc(l.area)}, approximate location. Open details">
        ${l.photo ? `<img src="${l.photo}" alt="">` : `<span class="preview-nophoto">${icon('photo')}</span>`}
        <span class="preview-text">
          <span class="t-headline preview-title">${esc(l.title)}</span>
          <span class="price-badge">${money(l.price)}</span>
          <span class="t-foot c2 preview-meta">${esc(l.detail)} · ${esc(l.area)}</span>
        </span>
      </button>
      ${dismiss ? `<button type="button" class="glass-btn" data-action="preview-dismiss" data-fid="preview-dismiss" aria-label="Dismiss preview">${icon('xmark-glass')}</button>` : ''}
    </div>`;
  }
  function selectionBlock(list) {
    const sel = state.selectedListingId && list.find(l => l.id === state.selectedListingId);
    if (sel) return `<div class="sheet-preview">${previewCard(sel)}</div>`;
    const g = state.cluster && markerGroups(list).find(g => g.key === state.cluster);
    if (g) {
      return `<div class="cluster-panel" role="group" aria-labelledby="cluster-title">
        <div class="cluster-head"><h2 class="t-headline" id="cluster-title" style="margin:0">${g.items.length} listings in this area</h2>
          <button type="button" class="glass-btn" data-action="cluster-close" data-fid="cluster-close" aria-label="Close listings in this area">${icon('xmark-glass')}</button></div>
        <ul class="plain-list cluster-list">${g.items.map(p => `<li>${previewCard(p.l, { fid: 'cluster-item-' + p.l.id, dismiss: false })}</li>`).join('')}</ul>
      </div>`;
    }
    return '';
  }

  // ---------- Discovery screen (S01 · S03 · S06 · S09 · S18 · S19 · S20) ----------

  function summaryText(n) { return state.query ? `${plural(n, 'result')} · ${state.query}` : `${plural(n, 'listing')} · ${catLabel(state.category)}`; }

  function screenDiscovery() {
    const list = compute();
    const n = list.length;
    const home = state.screen === 'home';
    const listHeader = state.query
      ? `<h2 class="t-headline" style="margin:0" id="results-count">${plural(n, 'result')}</h2>`
      : `<h2 class="t-sub c2" style="margin:0" id="results-count">Listings within ${state.radius} miles</h2>`;
    const controls = home
      ? `<div class="sheet-controls is-home" style="align-items:stretch">
          <div class="handle-space" data-drag></div>
          <img class="logo" src="assets/img/craigslist-logo.svg" alt="craigslist">
          ${searchFieldIdle()}
          <div class="sheet-actions">${filtersBtn()}<button type="button" class="quiet" data-action="open-saved" data-fid="saved-btn" aria-haspopup="dialog">${icon('saved-search')}<span>Saved searches</span></button></div>
        </div>`
      : `<div class="sheet-controls">
          <div class="sheet-header" data-drag>
            ${state.screen === 'browse' ? `<h1 class="t-headline" id="browse-title" style="margin:0">${esc(catLabel(state.category))}</h1>` : ''}
            <button type="button" class="quiet map-toggle" data-action="map-expand" data-fid="map-toggle">${icon('map')}<span>Expand map</span></button>
          </div>
          ${state.query ? searchFieldFilled() : searchFieldIdle()}
          <div class="sheet-actions">${filtersBtn()}${saveSearchBtn()}</div>
        </div>`;
    return `${mapBg({ home, markers: markers(list) })}
      <section class="sheet dsheet surface-sheet" id="dsheet" aria-label="${home ? `Listings near ${esc(loc().label)}` : 'Results'}">
        <button type="button" class="grabber-btn" data-action="grabber" data-drag data-fid="grabber" aria-label="${grabberLabel()}"></button>
        ${selectionBlock(list)}
        <div class="sheet-compact" data-drag>
          <h2 class="t-sub-e" style="margin:0" id="summary">${esc(summaryText(n))}</h2>
          <button type="button" class="quiet map-toggle" data-action="map-collapse" data-fid="map-collapse">${icon('chevron-up')}<span>Collapse map</span></button>
        </div>
        <div class="sheet-full">
          ${controls}
          <div class="list-scroll" data-scroll="list">${n ? `<div class="list-header">${listHeader}${sortBtn()}</div>${grid(list)}` : emptyState()}</div>
        </div>
      </section>
      <div class="scroll-edge"></div>
      ${filtersRow()}
      <p class="map-label is-home-label">Within ${state.radius} miles of your search location</p>
      <p class="map-label is-map-label">Approximate listing locations · ${state.radius}-mile search area</p>
      ${tabbar()}`;
  }

  // ---------- Sheet snapping ----------

  function insets() {
    const probe = document.getElementById('inset-probe'); // top: var(--top), height: var(--bottom)
    return { top: probe.offsetTop, bottom: probe.offsetHeight, h: appEl.clientHeight };
  }
  function snapTops() {
    const { top, bottom, h } = insets();
    const hasPreview = !!(state.selectedListingId && compute().some(l => l.id === state.selectedListingId));
    const collapsed = h - (158 + bottom) - (hasPreview ? PREVIEW_BLOCK : 0);  // M1: sheet top 740 on 932
    const expanded = top + 88;                                                 // 147 on 932 (F4)
    const half = Math.min(top + 389, h - 420);                                 // 448 on 932 (F4, S01)
    return { collapsed, half: Math.max(expanded, Math.min(half, collapsed)), expanded };
  }
  function grabberLabel() {
    const name = { collapsed: 'collapsed, map in view', half: 'half height', expanded: 'expanded' }[state.sheet];
    const next = { collapsed: 'show map and listings', half: 'expand listings', expanded: 'show the map' }[state.sheet];
    return `Results sheet, ${name}. Activate to ${next}. Use arrow keys to resize.`;
  }
  function applySheet({ animate = true } = {}) {
    const sheet = $('#dsheet');
    if (!sheet) return;
    const tops = snapTops();
    sheet.classList.toggle('no-anim', !animate);
    appEl.querySelector('.map-world').classList.toggle('no-anim', !animate);
    sheet.style.top = tops[state.sheet] + 'px';
    sheet.classList.toggle('is-compact', state.sheet === 'collapsed');
    appEl.dataset.sheet = state.sheet;
    const g = $('[data-fid="grabber"]'); if (g) g.setAttribute('aria-label', grabberLabel());
    keepSelectionVisible(tops[state.sheet]);
  }
  function setSheet(snap, opts) { state.sheet = snap; if (snap === 'expanded') { state.pan = { x: 0, y: 0 }; applyPan(); } applySheet(opts); }

  // Keep a selected marker or cluster between the controls and the sheet by panning the static map.
  // Positions are computed from the target frame (not mid-animation values).
  function keepSelectionVisible(sheetTop) {
    if (state.sheet === 'expanded') return;
    const list = compute();
    const g = state.selectedListingId ? groupFor(state.selectedListingId, list) : (state.cluster && markerGroups(list).find(g => g.key === state.cluster));
    if (!g) return;
    const { top } = insets();
    const W = appEl.clientWidth, c = loc().px;
    const worldLeft = W / 2 - c[0] * PX;
    const worldTop = top - 59 + (state.sheet === 'collapsed' ? -78.65 : -208.65) + (898 - c[1]) * PX;
    const x = worldLeft + g.x, y = worldTop + g.y;           // marker point (price markers sit above it)
    const minY = top + 44 + 48 + 52, maxY = sheetTop - 16;   // below filters + map label, above the sheet
    const minX = 64, maxX = W - 64;
    let { x: px, y: py } = state.pan;
    if (y + py < minY || y + py > maxY) py = Math.round((minY + maxY) / 2 - y);
    if (x + px < minX || x + px > maxX) px = Math.round(W / 2 - x);
    if (px !== state.pan.x || py !== state.pan.y) { state.pan = { x: px, y: py }; applyPan(); }
  }
  function applyPan() {
    const w = $('.map-world');
    if (!w) return;
    w.style.setProperty('--pan-x', state.pan.x + 'px');
    w.style.setProperty('--pan-y', state.pan.y + 'px');
  }

  // Dragging from the grabber or sheet header; listings scroll on their own (touch-action differs per area).
  let drag = null, suppressClick = false;
  function zoomFactor() { const r = appEl.getBoundingClientRect(); return r.height / appEl.offsetHeight || 1; }
  appEl.addEventListener('pointerdown', e => {
    const zone = e.target.closest('[data-drag]');
    const sheet = $('#dsheet');
    if (!zone || !sheet || !sheet.contains(zone) || state.overlay) return;
    const ctl = e.target.closest('button, a, input');
    if (ctl && !ctl.classList.contains('grabber-btn')) return;
    drag = { id: e.pointerId, y0: e.clientY, top0: parseFloat(sheet.style.top), moved: false, last: [{ t: e.timeStamp, y: e.clientY }], zone };
  });
  appEl.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.id) return;
    const dy = (e.clientY - drag.y0) / zoomFactor();
    if (!drag.moved && Math.abs(dy) < 6) return;
    const sheet = $('#dsheet');
    if (!drag.moved) { drag.moved = true; try { drag.zone.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ } sheet.classList.add('is-dragging'); }
    const tops = snapTops();
    const top = Math.min(tops.collapsed, Math.max(tops.expanded, drag.top0 + dy)); // stays inside the app viewport
    sheet.style.top = top + 'px';
    sheet.classList.toggle('is-compact', top > tops.collapsed - 70);
    drag.last.push({ t: e.timeStamp, y: e.clientY }); if (drag.last.length > 5) drag.last.shift();
    e.preventDefault();
  });
  function endDrag(e) {
    if (!drag || (e && e.pointerId !== drag.id)) return;
    const d = drag; drag = null;
    if (!d.moved) return;
    suppressClick = true; setTimeout(() => { suppressClick = false; }, 0);
    const sheet = $('#dsheet');
    sheet.classList.remove('is-dragging');
    const top = parseFloat(sheet.style.top);
    const a = d.last[0], b = d.last[d.last.length - 1];
    const v = (b.y - a.y) / Math.max(1, b.t - a.t) / zoomFactor(); // pt per ms, + is downward
    const tops = snapTops();
    let snap = SNAPS.reduce((best, s) => Math.abs(tops[s] - top) < Math.abs(tops[best] - top) ? s : best, 'half');
    if (Math.abs(v) > 0.5) { // a flick moves one position in its direction
      const order = SNAPS.slice().sort((x, y) => tops[x] - tops[y]); // expanded, half, collapsed
      const above = order.filter(s => tops[s] < top - 1), below = order.filter(s => tops[s] > top + 1);
      snap = v < 0 ? (above.length ? above[above.length - 1] : 'expanded') : (below.length ? below[0] : 'collapsed');
    }
    setSheet(snap);
    announce(`Results sheet ${snap === 'half' ? 'half height' : snap}`);
  }
  appEl.addEventListener('pointerup', endDrag);
  appEl.addEventListener('pointercancel', endDrag);
  appEl.addEventListener('click', e => { if (suppressClick) { e.stopPropagation(); e.preventDefault(); } }, true);

  // ---------- Search entry (S05 / S17) ----------

  function screenSearch() {
    const cur = normScope(scope());
    const rows = recents.map((r, i) => {
      const sc = normScope(r.scope);
      const title = r.query || `Browse ${catLabel(sc.category).toLowerCase()}`;
      const sub = scopeDiff(sc, cur);
      return `<li><button type="button" class="recent-row inset-focus" data-action="search-recent" data-index="${i}" aria-label="Recent search: ${esc(title)}${sub ? ', ' + esc(sub) : ''}">
        ${icon('clock')}<span class="recent-text"><span class="t-headline">${esc(title)}</span>${sub ? `<span class="t-sub c2">${esc(sub)}</span>` : ''}</span></button></li>`;
    }).join('');
    return `${mapBg({})}
      <section class="sheet is-search surface-sheet" aria-labelledby="search-title">
        <div class="sheet-controls search-controls">
          <div class="grabber in-flow" aria-hidden="true"></div>
          <h1 class="t-title1" id="search-title" style="margin:0">Search</h1>
          <div class="search-row">
            <form role="search" data-form="search" action="#" novalidate>
              <div class="field is-entry ${state.query ? 'has-clear' : ''}" id="entry-field">
                ${icon('search', 'field-icon')}
                <input id="search-input" type="search" name="q" enterkeyhint="search" autocomplete="off" autocapitalize="off" spellcheck="false"
                  placeholder="${esc(placeholder())}" aria-label="${SEARCH_LABEL}" aria-describedby="search-scope" value="${esc(state.query)}">
                <button type="button" class="field-clear" data-action="search-clear" aria-label="Clear text" ${state.query ? '' : 'hidden'}>${icon('xmark-circle-fill')}</button>
              </div>
            </form>
            <button type="button" class="text-btn" data-action="search-cancel">Cancel</button>
          </div>
          <p class="t-sub c2" style="margin:0" id="search-scope">${esc(scopeText(cur))}</p>
        </div>
        <div class="list-scroll recent-scroll is-entry">
          <div class="section-header"><h2 class="t-title3" style="margin:0">Recent searches</h2>
            ${recents.length ? `<button type="button" class="text-btn" data-action="recents-clear">Clear</button>` : ''}</div>
          ${recents.length ? `<ul class="plain-list">${rows}</ul>` : `<p class="t-sub c2" style="margin:12px 0 0">Searches you run appear here.</p>`}
        </div>
      </section>
      <div class="scroll-edge is-strong"></div>`;
  }

  // ---------- Item details (S12 / S13) ----------

  function pickupMapHtml(l) {
    if (D.details[l.id] && D.details[l.id].pickupMap) {
      return `<img class="pm-img" src="assets/map/pickup-map.png" alt="Map of the approximate pickup area in Northeast Minneapolis">`;
    }
    const x = l.mapPx[0] * PX, y = l.mapPx[1] * PX;
    return `<img class="pm-metro" src="assets/map/metro-map.png" alt="Map of the approximate pickup area in ${esc(areaName(l))}" style="left:calc(50% - ${x.toFixed(2)}px);top:${(75 - y).toFixed(2)}px">`;
  }

  function screenDetails() {
    const { id, ids } = state.details;
    const l = byId[id];
    const d = D.details[id];
    const idx = ids.indexOf(id);
    const title = d ? d.title : l.title;
    const photos = d ? d.gallery : (l.photo ? [l.photo] : []);
    // Only seller-provided facts: L01 from frame 18:501; others from the shared sample record.
    const facts = d ? d.facts : (l.miles != null ? [['Mileage', l.detail], ['Seller', l.seller]] : [['Details', l.detail]].concat(l.seller ? [['Seller', l.seller]] : []));
    const rows = [];
    for (let i = 0; i < facts.length; i += 2) {
      rows.push(`<div class="facts-row">${facts.slice(i, i + 2).map(([k, v]) => `<div class="fact"><span class="t-foot c2">${esc(k)}</span><span class="t-title3">${esc(v)}</span></div>`).join('')}</div>`);
    }
    const posted = `Posted ${l.hours} hr ago${l.seller ? ` • By ${l.seller.toLowerCase()}` : ''}`;
    const saved = savedListings.includes(id);
    const gallery = photos.length
      ? `<div class="gallery-track" data-gallery>${photos.map((p, i) => `<img src="${p}" alt="${esc(title)}, photo ${i + 1} of ${photos.length}"${i ? ' loading="lazy"' : ''}>`).join('')}</div>`
      : `<span class="no-photo">${icon('photo')}<span>No photo</span></span>`;
    const dots = photos.length > 1 ? `<div class="dots" role="group" aria-label="Photos">${photos.map((_, i) =>
      `<button type="button" class="${i === 0 ? 'is-current' : ''}" data-action="photo-go" data-index="${i}" aria-label="Show photo ${i + 1} of ${photos.length}" aria-current="${i === 0}"></button>`).join('')}</div>` : '';
    const mapsHref = `https://maps.apple.com/?q=${encodeURIComponent(areaName(l) + ', MN')}`;
    return `<div class="details" role="dialog" aria-modal="true" aria-labelledby="details-title">
      <div class="details-scroll" data-scroll="details">
        <div class="gallery">
          <div class="gallery-photo">
            ${gallery}
            <span class="price-badge">${money(l.price)}</span>
            ${photos.length ? `<span class="photo-counter">Photo <span data-photo-index>1</span> of ${photos.length}</span>` : ''}
          </div>
          ${dots}
        </div>
        <div class="title-block">
          <h1 class="t-title1" id="details-title" style="margin:0">${esc(title)}</h1>
          <p class="t-sub c2" style="margin:0">${esc(posted)}</p>
        </div>
        <div class="facts">${rows.join('')}<p class="t-foot c2" style="margin:0">Seller-provided details</p></div>
        ${d && d.description ? `<div class="desc"><h2 class="t-title3" style="margin:0">Description</h2><p class="t-body" style="margin:0">${esc(d.description)}</p></div>` : ''}
        <div class="pickup">
          <h2 class="t-title3" style="margin:0">Approximate pickup area</h2>
          <div><p class="t-body" style="margin:0">${esc(areaName(l))}</p><p class="t-sub c2" style="margin:0">General area only, not an exact address. The seller shares the meeting location when you arrange a time.</p></div>
          <div class="pickup-map">${pickupMapHtml(l)}<img class="pm-area" src="assets/map/pickup-area-overlay.svg" alt=""></div>
          <a class="open-maps" href="${mapsHref}" target="_blank" rel="noopener" data-fid="open-maps">${icon('map-purple', 'om-map')}<span>Open in Maps</span>${icon('external', 'om-ext')}<span class="sr-only"> (opens Apple Maps in a new tab)</span></a>
        </div>
        <div class="details-end" aria-hidden="true"></div>
      </div>
      <div class="details-fade-top"></div>
      <div class="modal-toolbar">
        <button type="button" class="glass-btn" data-action="details-close" data-fid="details-close" aria-label="Close">${icon('xmark-glass')}</button>
        <div class="toolbar-trailing">
          <button type="button" class="glass-btn" data-action="toggle-save-listing" data-fid="save-listing" aria-pressed="${saved}" aria-label="Save listing">${icon(saved ? 'bookmark-fill' : 'bookmark')}</button>
          <button type="button" class="glass-btn" data-action="open-more" data-fid="more-btn" aria-haspopup="menu" aria-expanded="false" aria-label="More actions">${icon('ellipsis')}</button>
        </div>
      </div>
      <div class="listing-nav">
        <button type="button" class="glass-btn" data-action="details-prev" data-fid="details-prev" aria-label="Previous listing" ${idx <= 0 ? 'disabled' : ''}>${icon('chevron-left')}</button>
        <span class="t-sub-e">Listing ${idx + 1} of ${ids.length}</span>
        <button type="button" class="glass-btn no-shadow" data-action="details-next" data-fid="details-next" aria-label="Next listing" ${idx >= ids.length - 1 ? 'disabled' : ''}>${icon('chevron-right')}</button>
      </div>
      <div class="contact-fade"></div>
      <div class="contact">
        <p class="t-sub c2" style="margin:0">Confirm availability and the meeting location with the seller. Inspect the ${l.miles != null ? 'vehicle' : 'item'} before paying.</p>
        <button type="button" class="primary-btn" data-action="open-contact" data-fid="contact-btn" aria-haspopup="dialog">Contact seller</button>
      </div>
    </div>`;
  }

  const SCREENS = { home: screenDiscovery, browse: screenDiscovery, results: screenDiscovery, search: screenSearch, details: screenDetails };

  // ---------- Sheets and menus ----------

  function sheetFrame(title, body, { cls = 'psheet' } = {}) {
    return `<div class="scrim anim-fade" data-action="sheet-close"></div>
      <div class="${cls} surface-sheet anim-sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title">
        <div class="psheet-header">
          <h2 class="t-title3" id="sheet-title" style="margin:0">${esc(title)}</h2>
          <button type="button" class="glass-btn" data-action="sheet-close" aria-label="Close">${icon('xmark-glass')}</button>
          <div class="grabber" aria-hidden="true"></div>
        </div>
        <div class="sheet-body">${body}</div>
      </div>`;
  }
  function crow({ action, id, label, selected, chevron, last, sub }) {
    return `<li><button type="button" class="crow t-body inset-focus ${selected ? 'is-selected' : ''} ${last ? 'no-sep' : ''}" data-action="${action}" data-id="${esc(id)}" aria-current="${!!selected}">
      <span class="crow-label">${esc(label)}${sub ? ` <span class="crow-sub">${esc(sub)}</span>` : ''}</span>${selected ? icon('checkmark', 'ic-check') : ''}${chevron ? icon('chevron', 'ic-chevron') : ''}</button></li>`;
  }
  function sheetCategory() {
    const row = (c, last) => crow({ action: 'category-pick', id: c.id, label: c.label, selected: c.id === state.category, chevron: c.chevron, last });
    return `<div class="scrim anim-fade" data-action="sheet-close"></div>
      <div class="csheet surface-sheet anim-sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title">
        <div class="csheet-header">
          <h2 class="t-title3" id="sheet-title" style="margin:0">Category</h2>
          <button type="button" class="glass-btn" data-action="sheet-close" aria-label="Close">${icon('xmark-glass')}</button>
          <div class="grabber" aria-hidden="true"></div>
        </div>
        <div class="csheet-list">
          <ul class="plain-list">${row(D.categories.top, false)}</ul>
          <h3 class="csection t-sub-e c2" style="margin:0">For sale</h3>
          <ul class="plain-list">${D.categories.forSale.map(c => row(c, c.last)).join('')}</ul>
          <h3 class="csection t-sub-e c2" style="margin:0">Other sections</h3>
          <ul class="plain-list">${D.categories.other.map(c => row(c, c.last)).join('')}</ul>
          <div class="csheet-end"></div>
        </div>
      </div>`;
  }
  function sheetLocation() {
    const rows = D.locations.map((l, i) => crow({ action: 'location-pick', id: l.id, label: l.label, sub: l.zip, selected: l.id === state.location, last: i === D.locations.length - 1 })).join('');
    return sheetFrame('Location', `<p class="t-foot c2" style="margin:0">Listings are searched around this area. Your own location isn’t used.</p><ul class="plain-list list-inset">${rows}</ul>`);
  }
  function sheetRadius() {
    const rows = D.radii.map((r, i) => crow({ action: 'radius-pick', id: String(r), label: `Within ${r} miles`, selected: r === state.radius, last: i === D.radii.length - 1 })).join('');
    return sheetFrame('Distance', `<p class="t-foot c2" style="margin:0">Measured from ${esc(loc().label)} ${esc(loc().zip)}</p><ul class="plain-list list-inset">${rows}</ul>`);
  }
  function moneyField(key, label, ph, val) {
    return `<div class="price-field">
      <label class="t-sub-e c2" for="price-${key}">${label}</label>
      <div class="money ${val != null ? 'has-value' : ''}">
        <span class="money-sym t-body" aria-hidden="true">$</span>
        <input id="price-${key}" class="t-body" type="text" inputmode="numeric" pattern="[0-9,]*" autocomplete="off" enterkeyhint="done"
          placeholder="${ph}" value="${val == null ? '' : val.toLocaleString('en-US')}" data-price="${key}" aria-describedby="sheet-context">
      </div>
    </div>`;
  }
  const contextLine = () => `<p class="t-foot c2" id="sheet-context" style="margin:0">${esc([state.query, scopeText({ ...scope(), price: null, seller: null, mileage: null })].filter(Boolean).join(' · '))}</p>`;
  const rangeError = p => p.min != null && p.max != null && p.min > p.max;
  const errorLine = p => `<p class="t-foot field-error" id="price-error" role="alert" ${rangeError(p) ? '' : 'hidden'}>Minimum is higher than maximum.</p>`;
  function sheetPrice() {
    const p = state.draft.price;
    return sheetFrame('Price', `${contextLine()}
      <form class="price-fields" data-form="sheet" action="#" novalidate>
        ${moneyField('min', 'Minimum', 'No min', p.min)}${moneyField('max', 'Maximum', 'No max', p.max)}
        <button type="submit" hidden tabindex="-1"></button>
      </form>
      ${errorLine(p)}
      <div class="price-actions">
        <button type="button" class="text-btn" data-action="draft-clear-price" ${hasPrice(p) ? '' : 'disabled'}>Clear price</button>
        <button type="button" class="primary-btn" data-action="sheet-apply">Apply</button>
      </div>`);
  }
  function chipGroup(name, label, options, value) {
    return `<fieldset class="chip-group"><legend class="t-sub-e c2">${label}</legend><div class="chips">
      ${options.map(o => `<label class="chip ${o.id === value ? 'is-applied' : ''}"><input type="radio" name="${name}" value="${o.id == null ? '' : o.id}" ${o.id === value ? 'checked' : ''}><span>${esc(o.label)}</span></label>`).join('')}
    </div></fieldset>`;
  }
  function sheetFilters() {
    const dr = state.draft;
    const n = compute({ ...state, filters: dr }).length;
    return sheetFrame('Filters', `${contextLine()}
      <form class="filters-form" data-form="sheet" action="#" novalidate>
        <div class="price-fields">${moneyField('min', 'Minimum price', 'No min', dr.price.min)}${moneyField('max', 'Maximum price', 'No max', dr.price.max)}</div>
        ${errorLine(dr.price)}
        ${chipGroup('seller', 'Seller', D.sellers, dr.seller)}
        ${vehicleScope(state.category) ? chipGroup('mileage', 'Mileage', D.mileages, dr.mileage) : ''}
        <button type="submit" hidden tabindex="-1"></button>
      </form>
      <div class="price-actions">
        <button type="button" class="text-btn" data-action="draft-reset" ${filterCount(dr) ? '' : 'disabled'}>Reset filters</button>
        <button type="button" class="primary-btn" data-action="sheet-apply" data-count>Show ${plural(n, 'result')}</button>
      </div>`, { cls: 'psheet is-tall' });
  }
  function sheetSaved() {
    const rows = savedSearches.map((s, i) => {
      const sc = normScope(s.scope);
      const title = s.query || `Browse ${catLabel(sc.category).toLowerCase()}`;
      return `<li class="saved-row">
        <button type="button" class="recent-row inset-focus" data-action="saved-run" data-index="${i}" aria-label="Run saved search: ${esc(title)}, ${esc(scopeText(sc))}">
          ${icon('saved-search')}<span class="recent-text"><span class="t-headline">${esc(title)}</span><span class="t-sub c2">${esc(scopeText(sc))}</span></span></button>
        <button type="button" class="field-clear" data-action="saved-remove" data-index="${i}" aria-label="Remove saved search ${esc(title)}">${icon('xmark-circle-fill')}</button>
      </li>`;
    }).join('');
    return sheetFrame('Saved searches', savedSearches.length
      ? `<ul class="plain-list">${rows}</ul>`
      : `<p class="t-sub c2" style="margin:0">No saved searches yet. Use Save search on a category or results list to keep it here.</p>`, { cls: 'psheet is-tall' });
  }
  function sheetContact() {
    const l = byId[state.overlay.id];
    const title = D.details[l.id] ? D.details[l.id].title : l.title;
    if (state.overlay.sent) {
      return sheetFrame('Contact seller', `<div class="contact-done">
          <h3 class="t-headline" style="margin:0">Message not sent</h3>
          <p class="t-sub c2" style="margin:0">This is a sample listing, so there’s no seller to receive it. Your message wasn’t stored.</p>
        </div>
        <div class="price-actions"><button type="button" class="primary-btn" data-action="sheet-close" data-fid="contact-done">Done</button></div>`);
    }
    return sheetFrame('Contact seller', `
      <div class="contact-listing">
        ${l.photo ? `<img src="${l.photo}" alt="">` : `<span class="preview-nophoto is-small">${icon('photo')}</span>`}
        <span><span class="t-headline" style="display:block">${esc(title)}</span><span class="t-sub c2">${money(l.price)} · ${esc(areaName(l))}</span></span>
      </div>
      <form data-form="contact" action="#" novalidate class="contact-form">
        <label class="t-sub-e c2" for="contact-message">Message</label>
        <textarea id="contact-message" class="t-body" rows="3" maxlength="500">Hi, I’m interested in your ${esc(title)}.</textarea>
        <p class="t-foot c2" style="margin:0">Sample listing: messages aren’t sent.</p>
        <button type="submit" class="primary-btn">Send message</button>
      </form>`);
  }
  function menuHtml(items) {
    const r = state.overlay.rect;
    const appRect = appEl.getBoundingClientRect();
    const zoom = appRect.width / appEl.offsetWidth || 1;
    const top = (r.bottom - appRect.top) / zoom + 6;
    const right = Math.max((appRect.right - r.right) / zoom, 12);
    return `<div class="menu-catcher" data-action="sheet-close"></div>
      <div class="menu anim-fade" role="menu" aria-label="${state.overlay.type === 'sort' ? 'Sort' : 'More actions'}" style="top:${top.toFixed(0)}px;right:${right.toFixed(0)}px">${items}</div>`;
  }
  function menuSort() {
    return menuHtml(D.sorts.map(s => `<button type="button" class="menu-item" role="menuitemradio" aria-checked="${s.id === state.sort}" data-action="sort-pick" data-id="${s.id}">
      <span>${esc(s.label)}</span>${s.id === state.sort ? icon('checkmark', 'ic-check') : ''}</button>`).join(''));
  }
  function menuMore() {
    const copied = state.overlay.copied;
    return menuHtml(`<button type="button" class="menu-item" role="menuitem" data-action="share-listing"><span>Share listing</span></button>
      <button type="button" class="menu-item" role="menuitem" data-action="copy-link"><span>${copied ? 'Link copied' : 'Copy link'}</span>${copied ? icon('checkmark', 'ic-check') : ''}</button>`);
  }
  const SHEETS = { category: sheetCategory, location: sheetLocation, radius: sheetRadius, price: sheetPrice, filters: sheetFilters, saved: sheetSaved, contact: sheetContact, sort: menuSort, more: menuMore };
  const isMenu = o => o && (o.type === 'sort' || o.type === 'more');

  // ---------- Rendering ----------

  // Re-render the current screen. On discovery screens the list and filter-row scroll are kept unless reset.
  function render({ resetScroll = false } = {}) {
    const prevList = $('[data-scroll="list"]'), prevFilters = $('.filters');
    const keep = !resetScroll && isDiscovery() && appEl.dataset.screen && isDiscovery(appEl.dataset.screen);
    const listY = keep && prevList ? prevList.scrollTop : 0, filterX = keep && prevFilters ? prevFilters.scrollLeft : 0;
    screenEl.innerHTML = SCREENS[state.screen]();
    appEl.classList.toggle('on-home', state.screen === 'home');
    appEl.dataset.screen = state.screen;
    if (isDiscovery()) {
      applySheet({ animate: false }); // size the sheet first so the list can hold its scroll position
      const list = $('[data-scroll="list"]'), filters = $('.filters');
      if (list) list.scrollTop = listY;
      if (filters) filters.scrollLeft = filterX;
    } else {
      delete appEl.dataset.sheet;
    }
    renderOverlay();
    if (state.screen === 'details') bindGallery();
  }
  function renderOverlay() {
    const o = state.overlay;
    overlayEl.innerHTML = o ? SHEETS[o.type]() : '';
    screenEl.inert = !!o && !isMenu(o);
    appEl.classList.toggle('has-sheet', !!o && !isMenu(o));
  }
  function focusFid(fid) {
    if (!fid) return false;
    const el = appEl.querySelector(`[data-fid="${fid}"]`);
    if (el && !el.disabled && el.offsetParent !== null) { el.focus({ preventScroll: true }); return true; }
    return false;
  }
  function focusFirst(container) {
    const el = container && [...container.querySelectorAll('button:not([tabindex="-1"]):not([disabled]), input, textarea, a[href]')].find(e => e.offsetParent !== null);
    if (el) el.focus({ preventScroll: true });
  }

  // Context snapshot: screen, sheet position, map selection and pan, list scroll, filter-row position (F1 returnTo).
  function snapshot(fid) {
    const list = $('[data-scroll="list"]'), filters = $('.filters');
    return { screen: state.screen, sheet: state.sheet, pan: { ...state.pan }, selectedListingId: state.selectedListingId, cluster: state.cluster,
      listScrollY: list ? list.scrollTop : 0, filterRowScrollX: filters ? filters.scrollLeft : 0, clusterScrollY: $('.cluster-list') ? $('.cluster-list').scrollTop : 0, fid };
  }
  function restore(snap) {
    Object.assign(state, { screen: snap.screen, sheet: snap.sheet || state.sheet, pan: snap.pan || { x: 0, y: 0 }, selectedListingId: snap.selectedListingId, cluster: snap.cluster || null });
    render({ resetScroll: true });
    const list = $('[data-scroll="list"]'), filters = $('.filters'), cl = $('.cluster-list');
    if (list) list.scrollTop = snap.listScrollY;
    if (filters) filters.scrollLeft = snap.filterRowScrollX;
    if (cl) cl.scrollTop = snap.clusterScrollY || 0;
    if (!focusFid(snap.fid)) focusFirst(screenEl);
  }

  function scrollFiltersTo(fid) {
    const filters = $('.filters');
    if (!filters) return;
    const el = fid && filters.querySelector(`[data-fid="${fid}"]`);
    if (!el) { filters.scrollLeft = 0; return; }
    const pill = el.closest('.pill');
    filters.scrollLeft = Math.max(0, pill.offsetLeft + pill.offsetWidth + 16 - filters.clientWidth);
  }
  const firstApplied = () => hasPrice() ? 'pill-price' : state.filters.seller ? 'pill-seller' : state.filters.mileage ? 'pill-mileage' : null;

  // Re-run after a scope change, staying on the current sheet position. Map selections that no longer match clear.
  function rerun({ focus, filtersTo } = {}) {
    const next = listScreen();
    if (next !== state.screen && state.sheet === defaultSheet(state.screen)) state.sheet = defaultSheet(next);
    state.screen = next;
    const ids = compute().map(l => l.id);
    if (state.selectedListingId && !ids.includes(state.selectedListingId)) state.selectedListingId = null;
    state.cluster = null;
    state.pan = { x: 0, y: 0 };
    const prevFilters = $('.filters') ? $('.filters').scrollLeft : 0;
    render({ resetScroll: true });
    if (filtersTo === undefined) { const f = $('.filters'); if (f) f.scrollLeft = prevFilters; } else scrollFiltersTo(filtersTo);
    if (!focusFid(focus)) focusFirst(screenEl);
    const n = ids.length;
    announce(n ? plural(n, state.query ? 'result' : 'listing') : 'No listings match.');
  }
  function showList(fid, { sheet } = {}) {
    state.screen = listScreen();
    state.sheet = sheet || defaultSheet();
    state.pan = { x: 0, y: 0 };
    render({ resetScroll: true });
    scrollFiltersTo(firstApplied());
    if (!focusFid(fid)) focusFirst(screenEl);
  }

  // ---------- Overlays ----------

  function openOverlay(type, trigger, extra = {}) {
    if (type === 'price' || type === 'filters') state.draft = { ...state.filters, price: { ...state.filters.price } }; // draft copied from applied (F1)
    state.overlay = { type, focusReturn: trigger && trigger.dataset.fid, rect: trigger ? trigger.getBoundingClientRect() : null, ...extra };
    renderOverlay();
    if (isMenu(state.overlay)) {
      trigger.setAttribute('aria-expanded', 'true');
      (overlayEl.querySelector('[aria-checked="true"]') || overlayEl.querySelector('.menu-item')).focus();
    } else if (type === 'price' && !hasPrice()) {
      $('#price-max').focus(); // S07: maximum focused on first open
    } else if (type === 'contact') {
      const ta = $('#contact-message'); ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);
    } else {
      const sel = overlayEl.querySelector('.crow.is-selected');
      if (sel) sel.focus(); else focusFirst(overlayEl.querySelector('[role="dialog"]'));
    }
  }
  function closeOverlay() {
    const fid = state.overlay && state.overlay.focusReturn;
    state.overlay = null; state.draft = null; // discard draft (F1)
    renderOverlay();
    const t = fid && appEl.querySelector(`[data-fid="${fid}"]`);
    if (t && t.hasAttribute('aria-expanded')) t.setAttribute('aria-expanded', 'false');
    focusFid(fid);
  }
  function dismissOverlay() { state.overlay = null; state.draft = null; renderOverlay(); }

  // ---------- Saved searches and recents ----------

  function isSearchSaved() { const k = searchKey(state.query, scope()); return savedSearches.some(s => searchKey(s.query, s.scope) === k); }
  function addRecent(query, sc) {
    const k = searchKey(query, sc);
    recents = [{ query, scope: sc }, ...recents.filter(r => searchKey(r.query, r.scope) !== k)].slice(0, 8);
    store.set('recents', recents);
  }
  function applyScope(sc) {
    const s = normScope(sc);
    state.category = s.category; state.location = s.location; state.radius = s.radius;
    state.filters = { price: s.price, seller: s.seller, mileage: s.mileage };
  }

  // ---------- Search ----------

  function openSearch(fid) {
    state.searchReturn = snapshot(fid);
    state.screen = 'search';
    render();
    const input = $('#search-input');
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }
  function submitSearch(q) {
    const query = q.trim().replace(/\s+/g, ' ');
    if (!query) return false; // empty submit: focus stays in the field
    state.searchReturn = null;
    state.selectedListingId = null;
    state.cluster = null;
    const keywordCategory = D.categoryKeywords[query.toLowerCase()];
    if (keywordCategory) {
      // "cars" opens Cars & trucks browsing (all vehicle listings), keeping location, distance, price and filters.
      addRecent(query.charAt(0).toUpperCase() + query.slice(1), { ...scope(), category: 'all' });
      state.category = keywordCategory;
      if (!vehicleScope(keywordCategory)) state.filters.mileage = null;
      state.query = '';
      showList('search-field');
      announce(`${catLabel(keywordCategory)}: ${plural(compute().length, 'listing')}`);
      return true;
    }
    state.query = query;
    addRecent(query, scope());
    showList('search-field');
    const n = compute().length;
    announce(n ? `${plural(n, 'result')} for ${query}` : 'No listings match your search.');
    return true;
  }
  function startVoice() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;
    try {
      const rec = new SR();
      rec.lang = 'en-US';
      rec.interimResults = true;
      const input = $('#search-input');
      input.placeholder = 'Listening…';
      rec.onresult = e => { input.value = [...e.results].map(r => r[0].transcript).join(''); syncEntryField(); };
      rec.onend = () => { if (input.isConnected) input.placeholder = placeholder(); };
      rec.start();
    } catch (_) { /* permission denied */ }
  }

  // ---------- Details ----------

  function openDetails(id, fid) {
    const ids = compute().map(l => l.id);
    state.returnTo = snapshot(fid);
    state.details = { id, ids: ids.includes(id) ? ids : [id] };
    state.screen = 'details';
    render();
    focusFid('details-close');
  }
  function stepDetails(dir) {
    const d = state.details;
    const i = d.ids.indexOf(d.id) + dir;
    if (i < 0 || i >= d.ids.length) return;
    d.id = d.ids[i];
    if (state.returnTo) {
      // Return to the listing now shown: its card in the list, or its marker on the map.
      state.returnTo.fid = 'card-' + d.id;
      if (state.returnTo.selectedListingId) { state.returnTo.selectedListingId = d.id; state.returnTo.cluster = null; state.returnTo.fid = 'preview-open'; }
    }
    render();
    focusFid(i === 0 ? 'details-next' : i === d.ids.length - 1 ? 'details-prev' : (dir < 0 ? 'details-prev' : 'details-next'));
    announce(`Listing ${i + 1} of ${d.ids.length}: ${byId[d.id].title}`);
  }
  function bindGallery() {
    const track = $('[data-gallery]');
    if (!track) return;
    track.addEventListener('scroll', () => {
      const i = Math.round(track.scrollLeft / track.clientWidth);
      const idx = $('[data-photo-index]'); if (idx) idx.textContent = i + 1;
      appEl.querySelectorAll('.dots button').forEach((b, j) => { b.classList.toggle('is-current', i === j); b.setAttribute('aria-current', String(i === j)); });
    }, { passive: true });
  }
  const listingUrl = id => location.href.split('#')[0] + '#listing=' + id;

  // ---------- Actions ----------

  function selectListing(id, { focus = 'preview-open' } = {}) {
    state.selectedListingId = id;
    state.cluster = null;
    if (state.sheet === 'expanded') state.sheet = 'half';
    render();
    focusFid(focus);
    const l = byId[id];
    announce(`${l.title}, ${money(l.price)}, ${l.detail}, ${l.area}`);
  }

  const actions = {
    noop() {},
    'tab-search'() { const list = $('[data-scroll="list"]'); if (list) list.scrollTo({ top: 0, behavior: 'smooth' }); },
    'sheet-close'() { closeOverlay(); },

    // Sheet grabber: tap cycles collapsed → half → expanded → collapsed.
    grabber() {
      const next = { collapsed: 'half', half: 'expanded', expanded: 'collapsed' }[state.sheet];
      setSheet(next);
      announce(`Results sheet ${next === 'half' ? 'half height' : next}`);
    },

    // Category
    'open-category'(el) { openOverlay('category', el); },
    'category-pick'(el) {
      const id = el.dataset.id;
      if (id === state.category) { closeOverlay(); return; } // same category: closes, nothing changes (F2)
      state.category = id;
      if (!vehicleScope(id)) state.filters.mileage = null;
      dismissOverlay();
      rerun({ focus: 'pill-category', filtersTo: null });
    },
    'category-remove'() { state.category = 'all'; rerun({ focus: 'pill-category', filtersTo: null }); },
    'category-all'() { state.category = 'all'; rerun({ focus: 'pill-category', filtersTo: null }); },

    // Location and distance
    'open-location'(el) { openOverlay('location', el); },
    'location-pick'(el) { state.location = el.dataset.id; dismissOverlay(); rerun({ focus: 'pill-location', filtersTo: null }); },
    'open-radius'(el) { openOverlay('radius', el); },
    'radius-pick'(el) { state.radius = +el.dataset.id; dismissOverlay(); rerun({ focus: 'pill-radius', filtersTo: null }); },
    'radius-50'() { state.radius = 50; rerun({ focus: 'pill-radius', filtersTo: null }); },

    // Search
    'open-search'(el) { openSearch(el.dataset.fid || 'search-field'); },
    'voice-search'() { openSearch('search-mic'); startVoice(); },
    'search-cancel'() { const snap = state.searchReturn; state.searchReturn = null; restore(snap); },
    'search-clear'() { const input = $('#search-input'); input.value = ''; syncEntryField(); input.focus(); },
    'search-recent'(el) {
      const r = recents[+el.dataset.index];
      applyScope(r.scope);
      state.searchReturn = null;
      if (r.query) submitSearch(r.query);
      else { state.query = ''; addRecent('', scope()); showList('search-field'); }
    },
    'recents-clear'() { recents = []; store.set('recents', recents); const v = $('#search-input').value; render(); const i = $('#search-input'); i.value = v; syncEntryField(); i.focus(); },
    'results-clear'() { state.query = ''; rerun({ focus: 'search-field', filtersTo: null }); },

    // Price and filters
    'open-price'(el) { openOverlay('price', el); },
    'draft-clear-price'() {
      state.draft.price = { min: null, max: null };
      overlayEl.querySelectorAll('[data-price]').forEach(i => { i.value = ''; i.closest('.money').classList.remove('has-value'); });
      syncDraftUi();
      $('#price-max').focus();
    },
    'price-remove'() { state.filters.price = { min: null, max: null }; rerun({ focus: 'pill-price', filtersTo: null }); },
    'open-filters'(el) { openOverlay('filters', el); },
    'draft-reset'() { state.draft = emptyFilters(); renderOverlay(); focusFirst(overlayEl.querySelector('form')); },
    'filters-reset'() { state.filters = emptyFilters(); rerun({ focus: 'filters-btn', filtersTo: null }); },
    'seller-remove'() { state.filters.seller = null; rerun({ focus: 'filters-btn' }); },
    'mileage-remove'() { state.filters.mileage = null; rerun({ focus: 'filters-btn' }); },
    'sheet-apply'() {
      const dr = state.draft;
      if (rangeError(dr.price)) { $('#price-min').focus(); return; }
      const type = state.overlay.type;
      state.filters = { ...dr, price: { ...dr.price } };
      dismissOverlay();
      rerun({ focus: type === 'price' ? 'pill-price' : 'filters-btn', filtersTo: firstApplied() });
    },

    // Sort
    'open-sort'(el) { openOverlay('sort', el); },
    'sort-pick'(el) { state.sort = el.dataset.id; dismissOverlay(); render({ resetScroll: true }); focusFid('sort-btn'); announce(`Sorted by ${D.sorts.find(s => s.id === state.sort).label}`); },

    // Saved searches
    'toggle-save-search'() {
      const k = searchKey(state.query, scope());
      savedSearches = isSearchSaved() ? savedSearches.filter(s => searchKey(s.query, s.scope) !== k) : [{ query: state.query, scope: scope(), sort: state.sort }, ...savedSearches];
      store.set('saved-searches', savedSearches);
      $('[data-fid="save-search"]').outerHTML = saveSearchBtn();
      focusFid('save-search');
      announce(isSearchSaved() ? 'Search saved' : 'Saved search removed');
    },
    'open-saved'(el) { openOverlay('saved', el); },
    'saved-run'(el) {
      const s = savedSearches[+el.dataset.index];
      dismissOverlay();
      applyScope(s.scope); state.sort = s.sort || 'newest'; state.query = s.query;
      state.selectedListingId = null; state.cluster = null;
      showList('search-field');
    },
    'saved-remove'(el) { savedSearches.splice(+el.dataset.index, 1); store.set('saved-searches', savedSearches); renderOverlay(); focusFirst(overlayEl.querySelector('[role="dialog"]')); },

    // Details
    'open-details'(el) { openDetails(el.dataset.id, el.dataset.fid); },
    'details-close'() { const snap = state.returnTo; state.returnTo = null; state.details = null; restore(snap); },
    'details-prev'() { stepDetails(-1); },
    'details-next'() { stepDetails(1); },
    'photo-go'(el) { const t = $('[data-gallery]'); t.scrollTo({ left: +el.dataset.index * t.clientWidth, behavior: 'smooth' }); },
    'toggle-save-listing'() {
      const id = state.details.id;
      savedListings = savedListings.includes(id) ? savedListings.filter(x => x !== id) : [...savedListings, id];
      store.set('saved-listings', savedListings);
      const saved = savedListings.includes(id);
      const b = $('[data-fid="save-listing"]');
      b.innerHTML = icon(saved ? 'bookmark-fill' : 'bookmark');
      b.setAttribute('aria-pressed', String(saved));
      announce(saved ? 'Listing saved' : 'Listing removed from saved');
    },
    'open-more'(el) { openOverlay('more', el); },
    async 'share-listing'() {
      const l = byId[state.details.id];
      if (navigator.share) { try { await navigator.share({ title: l.title, url: listingUrl(l.id) }); } catch (_) { /* cancelled */ } closeOverlay(); }
      else actions['copy-link']();
    },
    async 'copy-link'() {
      try { await navigator.clipboard.writeText(listingUrl(state.details.id)); } catch (_) { /* clipboard blocked */ }
      state.overlay.copied = true; renderOverlay(); overlayEl.querySelector('.menu-item:last-child').focus();
    },
    'open-contact'(el) { openOverlay('contact', el, { id: state.details.id }); },

    // Map
    'map-expand'() { setSheet('collapsed'); focusFid('map-collapse'); },
    'map-collapse'() { setSheet(defaultSheet()); focusFid(state.screen === 'home' ? 'search-field' : 'map-toggle'); },
    'marker-select'(el) { selectListing(el.dataset.id); },
    'cluster-open'(el) {
      state.cluster = el.dataset.key;
      state.selectedListingId = null;
      if (state.sheet !== 'half') state.sheet = 'half';
      render();
      focusFid('cluster-close');
      announce(`${el.dataset.key.split('-').length} listings in this area`);
    },
    'cluster-close'() { const key = state.cluster; state.cluster = null; render(); focusFid('cluster-' + key); },
    'preview-dismiss'() { const id = state.selectedListingId; state.selectedListingId = null; render(); if (!focusFid('marker-' + id)) focusFirst(screenEl); },
    'map-bg'(el, e) {
      if (e && e.target.closest('.marker, .cluster')) return;
      if (!state.selectedListingId && !state.cluster) return;
      state.selectedListingId = null; state.cluster = null; render();
    }
  };

  function syncEntryField() {
    const input = $('#search-input');
    if (!input) return;
    const has = input.value.length > 0;
    $('#entry-field').classList.toggle('has-clear', has);
    $('[data-action="search-clear"]').hidden = !has;
  }
  function syncDraftUi() {
    const dr = state.draft;
    const clear = overlayEl.querySelector('[data-action="draft-clear-price"]');
    if (clear) clear.disabled = !hasPrice(dr.price);
    const reset = overlayEl.querySelector('[data-action="draft-reset"]');
    if (reset) reset.disabled = !filterCount(dr);
    const err = $('#price-error');
    if (err) err.hidden = !rangeError(dr.price);
    const count = overlayEl.querySelector('[data-count]');
    if (count) count.textContent = `Show ${plural(compute({ ...state, filters: dr }).length, 'result')}`;
    overlayEl.querySelectorAll('.chip').forEach(c => c.classList.toggle('is-applied', c.querySelector('input').checked));
  }

  // ---------- Events ----------

  appEl.addEventListener('click', e => {
    const el = e.target.closest('[data-action]');
    if (!el || !appEl.contains(el)) {
      const m = e.target.closest('.money'); if (m) m.querySelector('input').focus();
      return;
    }
    if (el.getAttribute('aria-disabled') === 'true' || el.disabled) { e.preventDefault(); return; }
    const fn = actions[el.dataset.action];
    if (fn) { e.preventDefault(); fn(el, e); }
  });
  appEl.addEventListener('submit', e => {
    e.preventDefault();
    const f = e.target.dataset.form;
    if (f === 'search') { const input = $('#search-input'); if (!submitSearch(input.value)) input.focus(); }
    else if (f === 'sheet') actions['sheet-apply']();
    else if (f === 'contact') { state.overlay.sent = true; renderOverlay(); focusFid('contact-done'); }
  });
  appEl.addEventListener('input', e => {
    const t = e.target;
    if (t.id === 'search-input') { syncEntryField(); return; }
    if (t.dataset.price) {
      const digits = t.value.replace(/\D/g, '').replace(/^0+(?=\d)/, '').slice(0, 7);
      const val = digits ? parseInt(digits, 10) : null;
      state.draft.price[t.dataset.price] = val;
      t.value = val == null ? '' : val.toLocaleString('en-US');
      t.closest('.money').classList.toggle('has-value', val != null);
      syncDraftUi();
    }
  });
  appEl.addEventListener('change', e => {
    const t = e.target;
    if (t.type === 'radio' && state.draft) {
      state.draft[t.name] = t.value === '' ? null : (t.name === 'mileage' ? +t.value : t.value);
      syncDraftUi();
    }
  });

  document.addEventListener('keydown', e => {
    const o = state.overlay;
    if (isMenu(o)) {
      const items = [...overlayEl.querySelectorAll('.menu-item')];
      const i = items.indexOf(document.activeElement);
      const next = { ArrowDown: (i + 1) % items.length, ArrowUp: (i - 1 + items.length) % items.length, Home: 0, End: items.length - 1 }[e.key];
      if (next != null) { items[next].focus(); e.preventDefault(); return; }
      if (e.key === 'Tab') { e.preventDefault(); closeOverlay(); return; }
    }
    // Grabber: arrow keys move one position.
    if (document.activeElement && document.activeElement.classList.contains('grabber-btn') && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      const i = SNAPS.indexOf(state.sheet) + (e.key === 'ArrowUp' ? 1 : -1);
      if (i >= 0 && i < SNAPS.length) { setSheet(SNAPS[i]); announce(`Results sheet ${SNAPS[i] === 'half' ? 'half height' : SNAPS[i]}`); }
      e.preventDefault();
      return;
    }
    if (e.key !== 'Escape') return;
    if (o) { e.preventDefault(); closeOverlay(); }
    else if (state.screen === 'search') { e.preventDefault(); actions['search-cancel'](); }
    else if (state.screen === 'details') { e.preventDefault(); actions['details-close'](); }
    else if (state.selectedListingId) { e.preventDefault(); actions['preview-dismiss'](); }
    else if (state.cluster) { e.preventDefault(); actions['cluster-close'](); }
  });

  overlayEl.addEventListener('touchmove', e => { if (e.target.closest('.scrim, .menu-catcher')) e.preventDefault(); }, { passive: false });

  // ---------- Viewport ----------

  const mobileMQ = window.matchMedia('(max-width: 520px)');
  function fitViewport() {
    if (mobileMQ.matches && window.visualViewport) {
      const vv = window.visualViewport;
      device.style.height = vv.height + 'px';
      device.style.transform = vv.offsetTop ? `translateY(${vv.offsetTop}px)` : '';
      appEl.classList.toggle('kb-open', window.innerHeight - vv.height > 120);
      device.style.removeProperty('--scale');
    } else {
      device.style.height = ''; device.style.transform = '';
      appEl.classList.remove('kb-open');
      device.style.setProperty('--scale', Math.min(1, (window.innerHeight - 48) / 940).toFixed(3));
    }
    if (isDiscovery() && !drag) applySheet({ animate: false });
  }
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', fitViewport);
    window.visualViewport.addEventListener('scroll', fitViewport);
  }
  window.addEventListener('resize', fitViewport);
  mobileMQ.addEventListener('change', fitViewport);
  window.addEventListener('scroll', () => { if (mobileMQ.matches && window.scrollY) window.scrollTo(0, 0); });
  appEl.addEventListener('scroll', () => { appEl.scrollTop = 0; appEl.scrollLeft = 0; });
  device.addEventListener('scroll', () => { device.scrollTop = 0; device.scrollLeft = 0; });

  // Read-only state view for review tooling.
  window.CL_PROTO = { get state() { return JSON.parse(JSON.stringify({ ...state, overlay: state.overlay && { ...state.overlay, rect: null } })); }, ids: () => compute().map(l => l.id), snapTops: () => snapTops() };

  fitViewport();
  render();

  // Shared listing links (#listing=L06) open that listing's details over Home.
  const m = location.hash.match(/listing=(L\d\d)/);
  if (m && byId[m[1]]) openDetails(m[1], 'card-' + m[1]);
})();
