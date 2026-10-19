/* Craigslist iOS redesign — browser prototype.
   One store for all screens. Every list, count, map marker, preview and listing navigation reads the same filtered
   set from compute(), which combines the query, location + proximity (real distance from the search centre),
   category, price, seller type and the vehicle filters (year, mileage, make, model) with the sort order.
   Sheets edit drafts; Apply commits; Close, Cancel or the scrim discards.
   Every search goes through one simulated request lifecycle (loading → slow notice → success | failed, with Retry).
   Cards, count and markers come from the last successful request; a newer request supersedes older ones. */
(function () {
  'use strict';

  const D = window.CL_DATA;
  const byId = Object.fromEntries(D.listings.map(l => [l.id, l]));
  const IMG = 'assets/icons/';
  const PX = 0.5104;                       // pt per metro-map image px
  const SEARCH_LABEL = 'Search listings';
  const UNAVAILABLE = 'not available in this prototype';

  const appEl = document.getElementById('app');
  const screenEl = document.getElementById('screen');
  const overlayEl = document.getElementById('overlay');
  const liveEl = document.getElementById('live');
  const device = document.getElementById('device');

  // ---------- Simulated network conditions (desktop controls, or URL ?network=slow|fail&removed=L01) ----------

  const params = new URLSearchParams(location.search);
  const sim = {
    network: ['slow', 'fail'].includes(params.get('network')) ? params.get('network') : 'normal',
    failArmed: params.get('network') === 'fail',   // "Fail once": the next search fails, then Retry works
    removedId: byId[params.get('removed')] ? params.get('removed') : null
  };
  const TIMING = { response: 650, slowResponse: 6000, slowNotice: 2500 };

  // ---------- Local persistence ----------

  const store = {
    get(key, fallback) { try { const v = localStorage.getItem('cl-proto-' + key); return v ? JSON.parse(v) : fallback; } catch (_) { return fallback; } },
    set(key, val) { try { localStorage.setItem('cl-proto-' + key, JSON.stringify(val)); } catch (_) { /* private mode */ } }
  };
  let saved = store.get('saved-listings', []).filter(id => byId[id]);
  let recents = store.get('recents-v3', null) || D.recentSeed.slice();
  // Exploration · returning to a car search (proposed concept). Saved searches are kept apart from saved listings.
  let savedSearches = store.get('saved-searches-v1', []);     // [{ id, crit, alerts: off|daily|weekly, savedAt, lastViewedAt }]
  let priceAlerts = store.get('price-alerts-v1', []).filter(id => byId[id]);   // listing ids with price-drop alerts on
  let demo = store.get('demo-v1', { newInventory: false, addedAt: 0, priceDrop: null });
  const persistSaved = () => store.set('saved-searches-v1', savedSearches);
  const persistAlerts = () => store.set('price-alerts-v1', priceAlerts);
  // Simulated events change the sample data itself, so cards, counts, markers and details stay in step.
  function applyDemo() {
    const n = byId.L14;
    n.hidden = !demo.newInventory; n.addedAt = demo.addedAt || 0;
    const l = byId.L01;
    if (demo.priceDrop) { l.price = demo.priceDrop.to; l.priceWas = demo.priceDrop.from; l.priceDropOn = demo.priceDrop.on; }
    else { l.price = 8900; delete l.priceWas; delete l.priceDropOn; }
    store.set('demo-v1', demo);
  }
  applyDemo();

  // ---------- State (one shared filter state for every screen) ----------

  const noPrice = () => ({ min: null, max: null });
  // Filters-sheet fields. Vehicle fields (year, mileage, make, model) apply only to Cars & trucks.
  const noExtras = () => ({ seller: null, yearMin: null, yearMax: null, mileage: null, make: null, model: null });
  function initialState() {
    return {
      screen: 'home',          // home | browse | results | search | details
      query: '',
      category: 'all',
      location: 'mpls',
      radius: 25,
      draftLocation: 'mpls',   // Location and Proximity sheets edit these until Apply
      draftRadius: 25,
      sort: 'newest',
      price: { applied: noPrice(), draft: noPrice() },
      extras: { applied: noExtras(), draft: noExtras() },
      view: 'list',            // list | map
      homeSheet: 'rest',       // Home sheet: rest (raised, map visible) | expanded (listings fill the screen)
      selectedListingId: null,
      expandedCluster: null,
      pan: { x: 0, y: 0 },
      mapScale: 1,
      details: null,           // { id, ids } — ids = the filtered set when details opened
      returnTo: null,
      searchReturn: null,
      overlay: null,           // { type, focusReturn, rect }
      results: null,           // last successfully loaded search: { crit, key }. Everything on screen comes from it.
      req: null,               // request in flight or failed: { id, key, crit, status: loading | slow | failed, retry }
      removed: [],
      savedView: null,         // { id, newIds, since } for the saved search being viewed
      savedToast: null         // saved search id while the "Search saved" confirmation shows
    };
  }
  let state = initialState();

  // ---------- Helpers ----------

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = n => '$' + n.toLocaleString('en-US');
  const icon = (name, cls = '') => `<img src="${IMG}${name}.svg" alt="" class="${cls}">`;
  const $ = sel => appEl.querySelector(sel);
  const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
  const areaName = l => l.area === 'Northeast' ? 'Northeast Minneapolis' : l.area;
  const isDiscovery = (s = state.screen) => s === 'home' || s === 'browse' || s === 'results';
  const loc = (id = state.location) => D.locations.find(l => l.id === id);
  function catLabel(id) {
    if (id === 'all') return 'All categories';
    const c = [...D.categories.forSale, ...D.categories.other].find(c => c.id === id);
    return c ? c.label : id;
  }
  const isCars = (cat = state.category) => cat === 'cars-trucks';
  const scopeLine = () => `${catLabel(state.category)} · ${loc().label} · ${state.radius} miles`;
  // Sample coordinates were drawn on the supplied metro map (image px). They are placed on the interactive map by
  // anchoring ZIP 55401 (image px 601, 898) at its real position and using the image's scale (22.86 px per mile).
  // They stay illustrative points, not addresses.
  const GEO = { lat: 44.9855, lng: -93.2690, px: [601, 898] };
  const MILE_M = 1609.344;
  const toLatLng = ([x, y]) => [
    GEO.lat - (y - GEO.px[1]) / D.PX_PER_MILE / 69.055,
    GEO.lng + (x - GEO.px[0]) / D.PX_PER_MILE / (69.172 * Math.cos(GEO.lat * Math.PI / 180))
  ];
  function haversineMiles(a, b) {
    const R = 3958.7613, rad = d => d * Math.PI / 180;
    const dLat = rad(b[0] - a[0]), dLng = rad(b[1] - a[1]);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  D.listings.forEach(l => { l.latLng = toLatLng(l.mapPx); });
  D.locations.forEach(c => { c.latLng = toLatLng(c.px); });
  // Proximity: great-circle distance, the same geometry the map's circle uses.
  const milesFrom = (l, at = state.location) => haversineMiles(loc(at).latLng, l.latLng);

  const ago = l => l.minutes < 60 ? `${l.minutes} min ago` : `${l.hours} hr ago`;
  const agoLong = l => l.minutes < 60 ? plural(l.minutes, 'minute') + ' ago' : plural(l.hours, 'hour') + ' ago';
  const fmtDate = t => new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const hasPrice = (p = state.price.applied) => p.min != null || p.max != null;
  function priceLabel(p = state.price.applied) {
    if (p.min != null && p.max != null) return `${money(p.min)}–${money(p.max)}`;
    if (p.max != null) return `Up to ${money(p.max)}`;
    if (p.min != null) return `From ${money(p.min)}`;
    return 'Any price';
  }
  // Vehicle filters only count and apply in Cars & trucks.
  const activeExtras = (x = state.extras.applied, cat = state.category) => isCars(cat) ? x : { ...noExtras(), seller: x.seller };
  // Active additional filters: price, seller, year, mileage, make/model (one filter). Location, proximity and
  // category never count.
  function filterCount(price = state.price.applied, x = activeExtras()) {
    return (hasPrice(price) ? 1 : 0) + (x.seller ? 1 : 0) + (x.yearMin != null || x.yearMax != null ? 1 : 0) + (x.mileage ? 1 : 0) + (x.make ? 1 : 0);
  }
  function yearLabel(x) {
    if (x.yearMin != null && x.yearMax != null) return x.yearMin === x.yearMax ? `${x.yearMin}` : `${x.yearMin}–${x.yearMax}`;
    if (x.yearMin != null) return `${x.yearMin} or newer`;
    if (x.yearMax != null) return `${x.yearMax} or older`;
    return '';
  }
  function alsoFiltered(x = activeExtras()) {
    const parts = [];
    if (x.seller) parts.push(`${x.seller} only`);
    if (x.make) parts.push(x.model ? `${x.make} ${x.model}` : x.make);
    if (x.yearMin != null || x.yearMax != null) parts.push(yearLabel(x));
    if (x.mileage) parts.push('under 100,000 mi');
    return parts.length ? `Also filtered: ${parts.join(' · ')}` : '';
  }

  function words(s) { return s.toLowerCase().replace(/volkswagen/g, 'vw').replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean); }
  function inCategory(l, cat) {
    if (cat === 'all') return true;
    if (cat === 'all-for-sale') return D.forSaleIds.includes(l.category);
    return l.category === cat;
  }

  // The single filtered set behind every count, card, marker, preview and listing navigation.
  // Missing values never satisfy a filter on that field: unknown year/mileage/seller are excluded while it's on.
  function compute({ query = state.query, category = state.category, price = state.price.applied, extras = state.extras.applied, location = state.location, radius = state.radius } = {}) {
    const x = activeExtras(extras, category);
    const q = words(query);
    const list = D.listings
      .filter(l => !l.hidden && !state.removed.includes(l.id))
      .filter(l => inCategory(l, category))
      .filter(l => milesFrom(l, location) <= radius)                                // proximity: real distance
      .filter(l => { const t = words(l.title); return q.every(w => t.some(tw => tw.startsWith(w))); })
      .filter(l => (price.min == null || l.price >= price.min) && (price.max == null || l.price <= price.max)) // inclusive
      .filter(l => !x.seller || l.seller === x.seller)
      .filter(l => x.yearMin == null || (l.year != null && l.year >= x.yearMin))
      .filter(l => x.yearMax == null || (l.year != null && l.year <= x.yearMax))
      .filter(l => !x.mileage || (l.miles != null && l.miles < x.mileage))           // "Under" is strict
      .filter(l => !x.make || l.make === x.make)
      .filter(l => !x.model || l.model === x.model);
    const by = {
      newest: (a, b) => a.minutes - b.minutes,
      'price-asc': (a, b) => a.price - b.price,
      'price-desc': (a, b) => b.price - a.price
    }[state.sort];
    // Equal prices fall back to newest first, then ID, so the order is stable.
    return list.sort((a, b) => by(a, b) || a.minutes - b.minutes || a.id.localeCompare(b.id));
  }

  // The search a request is made for, and the listings on screen (from the last successful request).
  const criteria = () => ({ query: state.query, category: state.category, location: state.location, radius: state.radius, price: { ...state.price.applied }, extras: { ...activeExtras() } });
  const critKey = c => JSON.stringify(c);
  const shown = () => state.results ? compute(state.results.crit) : [];

  // Saved searches: short label ("Volkswagen Golf · Up to $10,000 · 25 mi") and full context.
  const titleCase = q => q.replace(/\b\w/g, c => c.toUpperCase());
  function searchLabel(c) {
    const parts = [c.query ? titleCase(c.query) : catLabel(c.category)];
    if (hasPrice(c.price)) parts.push(priceLabel(c.price));
    const also = alsoFiltered(c.extras).replace(/^Also filtered: /, '');
    if (also) parts.push(also);
    parts.push(`${c.radius} mi`);
    return parts.join(' · ');
  }
  function searchContext(c) {
    const parts = [];
    if (c.query) parts.push(titleCase(c.query));
    parts.push(catLabel(c.category), loc(c.location).label, `${c.radius} miles`);
    if (hasPrice(c.price)) parts.push(priceLabel(c.price));
    const also = alsoFiltered(c.extras).replace(/^Also filtered: /, '');
    if (also) parts.push(also);
    return parts.join(' · ');
  }
  const ALERTS = [{ id: 'off', label: 'Off' }, { id: 'daily', label: 'Daily' }, { id: 'weekly', label: 'Weekly' }];
  const alertsLabel = a => ALERTS.find(x => x.id === a).label;
  const matchedSaved = () => savedSearches.find(ss => critKey(ss.crit) === critKey(criteria()));
  // New matches = listings that arrived after this saved search was last viewed.
  const newSince = ss => compute(ss.crit).filter(l => (l.addedAt || 0) > ss.lastViewedAt);
  const isNewHere = id => { const m = matchedSaved(); return !!(m && state.savedView && state.savedView.id === m.id && state.savedView.newIds.includes(id)); };

  const listScreen = () => state.query ? 'results' : (state.category === 'all' ? 'home' : 'browse');
  const showsMarkers = () => !!state.query || state.category !== 'all';    // Home: circle only
  function announce(msg) { liveEl.textContent = ''; setTimeout(() => { liveEl.textContent = msg; }, 30); }
  function unavailable(cls, inner, label, extra = '') {
    return `<button type="button" class="${cls} is-muted" aria-disabled="true" tabindex="-1" aria-label="${esc(label)}, ${UNAVAILABLE}" data-action="noop"${extra}>${inner}</button>`;
  }

  // ---------- Building blocks ----------

  function outsideTab(img, label) {
    return `<button type="button" class="tab is-outside" aria-disabled="true" tabindex="-1" aria-label="${label}, outside this prototype" data-action="noop">${icon(img)}<span>${label}</span></button>`;
  }
  function tabbar() {
    return `<nav class="tabbar" aria-label="Tabs">
      <button type="button" class="tab is-current" aria-current="page" data-action="tab-search" data-fid="tab-search">${icon('tab-search')}<span>Search</span></button>
      ${outsideTab('tab-star', 'Favorites')}${outsideTab('tab-plus', 'Post')}${outsideTab('tab-person', 'Account')}${outsideTab('tab-chat', 'Chat')}
    </nav>`;
  }

  // The interactive map lives in #map-layer (created once). Screens only add the overlays that sit above it.
  function mapBg(opts = {}) {
    return `${opts.home ? '<div class="map-home-fade" aria-hidden="true"></div>' : ''}<div class="map-edge" aria-hidden="true"></div>`;
  }

  function pillDefault(label, { tag = false, action, fid, aria, disabled = false }) {
    const inner = `${tag ? icon('tag', 'ic-tag') : ''}<span>${esc(label)}</span>${icon('caret-down', 'ic-caret')}`;
    return `<div class="pill"><button type="button" class="pill-edit inset-focus" data-action="${disabled ? 'noop' : action}" data-fid="${fid}" aria-label="${esc(aria)}"${disabled ? ' aria-disabled="true"' : ' aria-haspopup="dialog"'}>${inner}</button></div>`;
  }
  function pillChange(label, { tag = false, action, fid, aria, disabled = false }) {
    const inner = `${tag ? icon('tag-purple', 'ic-tag') : ''}<span>${esc(label)}</span>${icon('caret-down-purple', 'ic-caret')}`;
    return `<div class="pill is-applied"><button type="button" class="pill-edit inset-focus" data-action="${disabled ? 'noop' : action}" data-fid="${fid}" aria-label="${esc(aria)}"${disabled ? ' aria-disabled="true"' : ' aria-haspopup="dialog"'}>${inner}</button></div>`;
  }
  function pillRemove(label, { action, removeAction, fid, aria, removeAria }) {
    return `<div class="pill is-applied">
      <button type="button" class="pill-edit inset-focus" data-action="${action}" data-fid="${fid}" aria-label="${esc(aria)}" aria-haspopup="dialog"><span>${esc(label)}</span></button>
      <span class="pill-divider" aria-hidden="true"></span>
      <button type="button" class="pill-remove inset-focus" data-action="${removeAction}" data-fid="${fid}-remove" aria-label="${esc(removeAria)}">${icon('xmark-pill')}</button>
    </div>`;
  }
  // One horizontally scrolling row. Order: location, proximity, category, price.
  function filtersRow() {
    const busy = false;   // the controls stay usable while a search is running
    const pills = [
      pillChange(loc().label, { action: 'open-location', fid: 'pill-location', aria: `Location: ${loc().label} ${loc().zip}. Change location`, disabled: busy }),
      pillChange(`${state.radius} miles`, { action: 'open-radius', fid: 'pill-radius', aria: `Distance: within ${state.radius} miles. Change distance`, disabled: busy }),
      state.category === 'all'
        ? pillDefault('All categories', { tag: true, action: 'open-category', fid: 'pill-category', aria: 'Category: All categories. Change category', disabled: busy })
        : pillChange(catLabel(state.category), { tag: true, action: 'open-category', fid: 'pill-category', aria: `Category: ${catLabel(state.category)}. Change category`, disabled: busy })
    ];
    if (hasPrice() && !busy) pills.push(pillRemove(priceLabel(), { action: 'open-price', removeAction: 'price-remove', fid: 'pill-price', aria: `Price: ${priceLabel()}. Edit price`, removeAria: 'Remove price filter' }));
    else if (hasPrice()) pills.push(pillChange(priceLabel(), { fid: 'pill-price', aria: `Price: ${priceLabel()}`, disabled: true }));
    else pills.push(pillDefault('Any price', { action: 'open-price', fid: 'pill-price', aria: 'Price: Any price. Set price', disabled: busy }));
    return `<div class="filters" role="group" aria-label="Quick filters">${pills.join('')}</div>`;
  }

  function card(l) {
    const photo = l.photo ? `<img src="${l.photo}" alt="" loading="lazy">` : `<span class="no-photo">${icon('photo')}<span>No photo</span></span>`;
    const seller = l.seller ? `<span class="card-seller"><span>·</span><span>${l.seller}</span></span>` : '';
    const isNew = isNewHere(l.id);
    const label = `${isNew ? 'New. ' : ''}${l.title}, ${money(l.price)}${l.priceWas ? `, price lowered from ${money(l.priceWas)}` : ''}, ${l.detail}${l.seller ? ', ' + l.seller : ''}, ${agoLong(l)}, ${l.area}${l.photo ? '' : ', no photo'}`;
    const meta = l.priceWas
      ? `<span class="card-meta is-drop">Price lowered from ${money(l.priceWas)}</span>`
      : `<span class="card-meta">${isNew ? '<b class="new-tag">New</b> · ' : ''}${ago(l)} • ${esc(l.area)}</span>`;
    return `<button type="button" class="card" data-action="open-details" data-id="${l.id}" data-fid="card-${l.id}" aria-label="${esc(label)}">
      <span class="card-photo">${photo}<span class="price-badge">${money(l.price)}</span></span>
      <span class="card-text">
        <span class="card-title">${esc(l.title)}</span>
        <span class="card-detail"><span class="${l.miles == null && l.category === 'cars-trucks' ? 'c2' : ''}">${esc(l.detail)}</span>${seller}</span>
        ${meta}
      </span>
    </button>`;
  }
  const grid = (list, attrs = '') => `<ul class="grid"${attrs}>${list.map(l => `<li>${card(l)}</li>`).join('')}</ul>`;
  const skeletonGrid = () => `<ul class="grid skeleton" aria-hidden="true">${'<li><span class="sk-photo"></span><span class="sk-line w80"></span><span class="sk-line w60"></span><span class="sk-line w70"></span></li>'.repeat(4)}</ul>`;
  const spinner = () => '<span class="spinner" aria-hidden="true"></span>';
  function sortBtn(enabled = true) {
    const label = D.sorts.find(s => s.id === state.sort).label;
    const inner = `<span>${label}</span>${icon('caret-down')}`;
    return enabled
      ? `<button type="button" class="menu-btn" data-action="open-sort" data-fid="sort-btn" aria-haspopup="menu" aria-expanded="false" aria-label="Sort: ${label}">${inner}</button>`
      : `<button type="button" class="menu-btn" aria-disabled="true" data-action="noop" aria-label="Sort: ${label}">${inner}</button>`;
  }

  function filtersBtn() {
    const n = filterCount();
    const label = `${icon('sliders')}<span>Filters${n ? ` (${n})` : ''}</span>`;
    return `<button type="button" class="quiet" data-action="open-filters" data-fid="filters-btn" aria-haspopup="dialog" aria-label="Filters${n ? `, ${n} active` : ''}">${label}</button>`;
  }
  function saveSearch() {
    if (matchedSaved()) return `<button type="button" class="quiet is-active" data-action="open-manage" data-fid="save-btn" aria-haspopup="dialog" aria-label="Search saved. Manage saved search">${icon('saved-search')}<span>Search saved</span></button>`;
    return `<button type="button" class="quiet" data-action="open-save" data-fid="save-btn" aria-haspopup="dialog">${icon('saved-search')}<span>Save search</span></button>`;
  }
  // Home: one entry for the most recent saved search; hidden when there is none.
  function continueEntry() {
    const ss = savedSearches[0];
    if (!ss) return '';
    const n = newSince(ss).length;
    return `<button type="button" class="continue" data-action="continue-search" data-fid="continue-search" aria-label="Continue your search: ${esc(searchLabel(ss.crit))}${n ? `, ${n} new` : ''}">
      <span class="continue-text"><span class="t-headline">Continue your search</span><span class="t-foot c2">${esc(searchLabel(ss.crit))}</span></span>
      <span class="continue-new t-sub-e">${n ? `${n} new` : ''}${icon('chevron', 'ic-chevron')}</span>
    </button>`;
  }
  function savedLine() {
    const ss = matchedSaved();
    if (!ss || state.savedToast) return '';
    const v = state.savedView && state.savedView.id === ss.id && state.savedView.newIds.length ? state.savedView : null;
    const text = `Saved search${v ? ` · ${v.newIds.length} new since ${fmtDate(v.since)}` : ''} · Alerts: ${alertsLabel(ss.alerts)}`;
    return `<div class="saved-line"><span class="t-sub c2">${esc(text)}</span><button type="button" class="text-btn" data-action="open-manage" data-fid="saved-manage" aria-haspopup="dialog" aria-label="Manage saved search">Manage</button></div>`;
  }
  function savedToast() {
    const ss = state.savedToast && matchedSaved();
    if (!ss || ss.id !== state.savedToast) return '';     // only on the saved search's own results
    return `<div class="saved-toast">
      <div class="saved-toast-text"><b class="t-headline">Search saved</b><span class="t-foot c2">${esc(searchLabel(ss.crit))} · Alerts: ${alertsLabel(ss.alerts)}</span></div>
      <button type="button" class="text-btn" data-action="open-manage" data-fid="toast-manage" aria-haspopup="dialog" aria-label="Manage saved search">Manage</button>
    </div>`;
  }
  const placeholder = () => state.category === 'all' ? 'Try searching ‘cars’' : `Search ${catLabel(state.category).toLowerCase()}`;
  function searchFieldIdle() {
    return `<div class="field has-main">
      <button type="button" class="field-main" data-action="open-search" data-fid="search-field" aria-label="${SEARCH_LABEL}">
        ${icon('search', 'field-icon')}<span class="field-text is-placeholder">${esc(placeholder())}</span>
      </button>
      ${unavailable('field-mic', icon('mic'), 'Search by voice')}
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
  const expandMapAvailable = () => true;
  function expandMapBtn() {
    const inner = `${icon('map')}<span>Expand map</span>`;
    return expandMapAvailable()
      ? `<button type="button" class="quiet map-toggle" data-action="map-expand" data-fid="map-toggle">${inner}</button>`
      : `<button type="button" class="quiet map-toggle" aria-disabled="true" data-action="noop" data-fid="map-toggle">${inner}</button>`;
  }

  // No matches: keep query and pills visible; offer edit and clear paths for whatever is narrowing the list.
  function emptyState() {
    const x = activeExtras();
    const extrasOn = filterCount(noPrice(), x) > 0;
    const actionsHtml = [];
    if (hasPrice()) actionsHtml.push(`<button type="button" class="primary-btn" data-action="price-remove" data-fid="recover-btn">Remove price filter</button>`);
    if (extrasOn) {
      actionsHtml.push(`<button type="button" class="${hasPrice() ? 'secondary-btn' : 'primary-btn'}" data-action="open-filters" data-fid="${hasPrice() ? 'recover-edit' : 'recover-btn'}">Edit filters</button>`);
      actionsHtml.push(`<button type="button" class="text-btn" data-action="extras-clear-applied" data-fid="recover-clear">Clear filters</button>`);
    }
    if (!hasPrice() && !extrasOn && state.radius < 50) actionsHtml.push(`<button type="button" class="primary-btn" data-action="open-radius" data-fid="recover-btn">Change distance</button>`);
    if (!actionsHtml.length) actionsHtml.push(`<button type="button" class="primary-btn" data-action="open-search" data-fid="recover-btn">Edit search</button>`);
    const why = hasPrice() && !extrasOn ? 'Try increasing your maximum price or removing the price filter.'
      : extrasOn ? 'Try editing or clearing your filters.'
      : state.radius < 50 ? `Nothing within ${state.radius} miles of ${loc().label}. Try a larger distance.` : 'Check the spelling or try different words.';
    return `<div class="no-results">
      <h2 class="t-headline" style="margin:0" id="results-count">No listings match your search.</h2>
      <p class="t-sub c2" style="margin:0">${esc(why)}</p>
      <div class="recovery">${actionsHtml.join('')}</div>
    </div>`;
  }

  // One status area at the top of the results: loading, then (slow) "Taking longer than usual", or the failure.
  function statusBlock() {
    const r = state.req;
    if (!r) return '';
    if (r.status === 'failed') {
      return `<div class="net-card is-failed" data-net="failed">
        <div class="net-head">${icon('alert', 'net-icon')}<h2 class="t-headline" style="margin:0" id="net-title" tabindex="-1">Couldn’t load listings</h2></div>
        <p class="t-sub c2" style="margin:0">Your search and filters are saved.</p>
        <button type="button" class="primary-btn net-retry" data-action="request-retry" data-fid="retry-btn">${icon('retry-white')}<span>Retry</span></button>
      </div>`;
    }
    if (r.status === 'slow') {
      return `<div class="net-card is-slow" data-net="slow">
        <div class="net-head">${spinner()}<h2 class="t-headline" style="margin:0" id="net-title" tabindex="-1">Taking longer than usual</h2></div>
        <p class="t-sub c2" style="margin:0">Your search is still running.</p>
      </div>`;
    }
    return `<div class="list-header status-row" data-net="loading"><span class="status-text">${spinner()}<span class="t-sub-e" id="net-title" tabindex="-1">Finding listings…</span></span></div>`;
  }
  function listBody(list) {
    const r = state.req;
    // While waiting: skeletons, never a count. Failed: only the message and Retry.
    if (r) return statusBlock() + (r.status === 'failed' ? '' : skeletonGrid());
    if (!state.results) return '';
    if (!list.length) return emptyState();
    const header = state.query
      ? `<h2 class="t-headline" style="margin:0" id="results-count" tabindex="-1">${plural(list.length, 'result')}</h2>`
      : `<h2 class="t-sub c2" style="margin:0" id="results-count" tabindex="-1">${plural(list.length, 'listing')} within ${state.radius} miles</h2>`;
    return `<div class="list-header">${header}${sortBtn()}</div>${grid(list)}`;
  }

  // ---------- Markers ----------

  // Group markers whose labels would overlap at the current zoom, in screen space. Price labels and cluster badges are
  // about 100 × 44 pt, so groups closer than that merge (repeated until no two groups overlap).
  function markerGroups(list) {
    let groups = list.slice().sort((a, b) => a.id.localeCompare(b.id)).map(l => {
      const pt = lmap.latLngToLayerPoint(l.latLng);
      return { x: pt.x, y: pt.y, items: [{ l, x: pt.x, y: pt.y }] };
    });
    for (let merged = true; merged;) {
      merged = false;
      outer: for (let i = 0; i < groups.length; i++) for (let j = i + 1; j < groups.length; j++) {
        const a = groups[i], b = groups[j];
        if (Math.abs(a.x - b.x) < 104 && Math.abs(a.y - b.y) < 46) {
          a.items.push(...b.items);
          a.x = a.items.reduce((s, p) => s + p.x, 0) / a.items.length;
          a.y = a.items.reduce((s, p) => s + p.y, 0) / a.items.length;
          groups.splice(j, 1); merged = true; break outer;
        }
      }
    }
    groups.forEach(g => {
      g.lat = g.items.reduce((s, p) => s + p.l.latLng[0], 0) / g.items.length;
      g.lng = g.items.reduce((s, p) => s + p.l.latLng[1], 0) / g.items.length;
      g.items.sort((a, b) => a.l.minutes - b.l.minutes);
      g.key = g.items.map(p => p.l.id).sort().join('-');
    });
    return groups;
  }
  function markerHtml(l, dy = 0) {
    const sel = state.selectedListingId === l.id;
    return `<button type="button" class="marker ${sel ? 'is-selected' : ''}" style="top:${dy}px" data-action="marker-select" data-id="${l.id}" data-fid="marker-${l.id}"
      aria-pressed="${sel}" aria-label="${esc(l.title)}, ${money(l.price)}, ${esc(l.area)}, approximate location">
      <span class="marker-capsule">${money(l.price)}</span>${sel ? `<span class="marker-pointer"><img src="assets/map/marker-pointer.svg" alt=""></span>` : ''}</button>`;
  }
  const divIcon = html => L.divIcon({ className: 'lf-icon', html, iconSize: [0, 0] });
  // Markers follow the filtered set on screen. Home before a category or query: circle only.
  function syncMarkers() {
    if (!lmap) return;
    markerLayer.clearLayers();
    if (!isDiscovery() || !showsMarkers() || state.req) return;
    for (const g of markerGroups(shown())) {
      const open = g.items.length === 1 || state.expandedCluster === g.key || g.items.some(p => p.l.id === state.selectedListingId);
      if (open) {
        g.items.forEach((p, i) => {
          const dy = g.items.length === 1 ? 0 : (i - (g.items.length - 1) / 2) * 46;
          const at = g.items.length === 1 ? p.l.latLng : [g.lat, g.lng];
          L.marker(at, { icon: divIcon(markerHtml(p.l, dy)), interactive: false, keyboard: false, zIndexOffset: p.l.id === state.selectedListingId ? 1000 : 0 }).addTo(markerLayer);
        });
      } else {
        L.marker([g.lat, g.lng], { icon: divIcon(`<button type="button" class="cluster" data-action="cluster-open" data-key="${g.key}" data-fid="cluster-${g.key}"
          aria-label="${g.items.length} listings close together. Show them"><span class="cluster-count t-sub-e">${g.items.length}</span><span class="t-sub-e">listings</span></button>`), interactive: false, keyboard: false }).addTo(markerLayer);
      }
    }
  }
  const markers = () => '';   // markers are map layers now (see syncMarkers)

  // ---------- Discovery screen ----------

  function screenDiscovery() {
    const list = shown();
    const r = state.req;
    const home = state.screen === 'home';
    const results = state.screen === 'results';
    const sel = state.view === 'map' && state.selectedListingId && list.find(l => l.id === state.selectedListingId);
    const also = alsoFiltered();
    const controls = home
      ? `<div class="sheet-controls is-home" style="align-items:stretch">
          <div class="handle-space"></div>
          ${searchFieldIdle()}
          ${continueEntry()}
          <div class="sheet-actions">${filtersBtn()}${unavailable('quiet', `${icon('saved-search')}<span>Saved searches</span>`, 'Saved searches')}</div>
          ${also ? `<p class="also-filtered" style="margin:0">${esc(also)}</p>` : ''}
        </div>`
      : `<div class="sheet-controls">
          <div class="sheet-header" data-drag>
            ${results ? `<p class="t-sub c2 header-scope" style="margin:0">${esc(scopeLine())}</p>` : `<h1 class="t-headline" id="browse-title" style="margin:0">${esc(catLabel(state.category))}</h1>`}
            ${expandMapBtn()}
          </div>
          ${results ? searchFieldFilled() : searchFieldIdle()}
          <div class="sheet-actions">${filtersBtn()}${saveSearch()}</div>
          ${also ? `<p class="also-filtered" style="margin:0">${esc(also)}</p>` : ''}
          ${savedLine()}
        </div>`;
    const summary = r ? { loading: 'Finding listings…', slow: 'Taking longer than usual', failed: 'Couldn’t load listings' }[r.status]
      : state.query ? `${plural(list.length, 'result')} · ${state.query}` : `${plural(list.length, 'listing')} · ${catLabel(state.category)}`;
    const preview = sel ? `<div class="preview" role="group" aria-label="Selected listing">
        <button type="button" class="preview-main" data-action="open-details" data-id="${sel.id}" data-fid="preview-open" aria-label="${esc(sel.title)}, ${money(sel.price)}, ${esc(sel.area)}, approximate location. Open details">
          ${sel.photo ? `<img src="${sel.photo}" alt="">` : `<span class="preview-nophoto">${icon('photo')}</span>`}
          <span class="preview-text">
            <span class="t-headline preview-title">${esc(sel.title)}</span>
            <span class="price-badge">${money(sel.price)}</span>
            <span class="t-foot c2 preview-meta">${esc(sel.area)} · Approximate location</span>
          </span>
        </button>
        <button type="button" class="glass-btn" data-action="preview-dismiss" data-fid="preview-dismiss" aria-label="Dismiss preview">${icon('xmark-glass')}</button>
      </div>` : '';
    return `${mapBg({ home, markers: markers(list) })}
      <section class="sheet dsheet surface-sheet" id="dsheet" aria-label="${home ? `Listings near ${esc(loc().label)}` : 'Results'}">
        ${home ? `<button type="button" class="grabber-btn" data-action="grabber" data-fid="grabber" aria-expanded="${state.homeSheet === 'expanded'}" aria-label="${grabberLabel()}"></button>` : ''}
        ${home ? '' : `<button type="button" class="grabber-btn" data-action="grabber" data-drag data-fid="grabber" aria-label="${grabberLabel()}"></button>`}
        <div class="sheet-compact" data-drag>
          <h2 class="t-sub-e" style="margin:0" id="summary">${esc(summary)}</h2>
          <button type="button" class="quiet map-toggle" data-action="map-collapse" data-fid="map-collapse">${icon('chevron-up')}<span>Collapse map</span></button>
        </div>
        <div class="sheet-full">
          ${controls}
          <div class="list-scroll" data-scroll="list" ${r && ['loading', 'slow'].includes(r.status) ? 'aria-busy="true"' : ''}>${listBody(list)}</div>
        </div>
      </section>
      ${preview}
      <div class="scroll-edge"></div>
      ${filtersRow()}
      <p class="map-label is-map-label">Approximate listing locations · ${state.radius}-mile search area</p>
      ${mapControls()}
      ${mapNotice()}
      ${savedToast()}
      ${tabbar()}`;
  }

  // ---------- Sheet positions and map framing ----------

  function insets() {
    const probe = document.getElementById('inset-probe');
    return { top: probe.offsetTop, bottom: probe.offsetHeight, h: appEl.clientHeight };
  }
  // Home at rest: high enough that the toolbar and one complete listing row sit above the bottom navigation, measured
  // from the rendered sheet (so it adapts to the viewport and to optional rows such as Continue your search).
  // Never lower than the Figma position, and never so high that the map and circle disappear.
  let homeRest = null;
  function homeRestTop() {
    const { top, h } = insets();
    const designed = Math.min(top + 389, h - 420), floor = top + 170;
    const sheet = $('#dsheet'), tab = $('.tabbar');
    if (state.screen !== 'home' || !sheet || !tab) return homeRest || designed;
    const z = zoomFactor(), sr = sheet.getBoundingClientRect(), list = sheet.querySelector('[data-scroll="list"]');
    const row = [...sheet.querySelectorAll('.grid > li')].slice(0, 2);
    if (!row.length) return homeRest || designed;
    const rowBottom = Math.max(...row.map(li => li.getBoundingClientRect().bottom)) - sr.top + (list ? list.scrollTop * z : 0);
    const tabTop = tab.getBoundingClientRect().top - appEl.getBoundingClientRect().top;
    homeRest = Math.round(Math.max(floor, Math.min(designed, (tabTop - 12 * z - rowBottom) / z)));
    return homeRest;
  }
  function sheetTop(view = state.view) {
    const { top, bottom, h } = insets();
    if (state.screen === 'home') return state.homeSheet === 'expanded' ? top + 88 : homeRestTop();
    return view === 'map' ? h - (158 + bottom) : top + 88;
  }
  const grabberLabel = () => state.screen === 'home'
    ? (state.homeSheet === 'expanded' ? 'Listings sheet, expanded. Activate to show the map.' : 'Listings sheet. Activate to expand the listings.')
    : state.view === 'map' ? 'Results sheet, map in view. Activate to show the list.' : 'Results sheet, list in view. Activate to show the map.';
  function setHomeSheet(v, { announceIt = true } = {}) {
    if (state.screen !== 'home' || state.homeSheet === v) { applyFrame(); return; }
    state.homeSheet = v;
    const list = $('[data-scroll="list"]'); if (v === 'rest' && list) list.scrollTop = 0;
    applyFrame();
    const g = $('[data-fid="grabber"]'); if (g) g.setAttribute('aria-expanded', String(v === 'expanded'));
    if (announceIt) announce(v === 'expanded' ? 'Listings expanded' : 'Map in view');
  }
  function applyFrame({ animate = true } = {}) {
    const sheet = $('#dsheet');
    if (!sheet) return;
    sheet.classList.toggle('no-anim', !animate);
    sheet.style.top = sheetTop() + 'px';
    sheet.classList.toggle('is-compact', state.view === 'map' && state.screen !== 'home');
    appEl.dataset.view = state.screen === 'home' ? 'home' : state.view;
    if (state.screen === 'home') appEl.dataset.home = state.homeSheet; else delete appEl.dataset.home;
    // Short exposed map (small phones at rest): map controls sit in one row under the filters.
    const { top: t0 } = insets();
    appEl.classList.toggle('map-short', state.screen === 'home' && sheetTop() - t0 < 300);
    const g = $('[data-fid="grabber"]'); if (g) g.setAttribute('aria-label', grabberLabel());
    syncMap();
  }

  // ---------- Interactive map (Leaflet + OpenStreetMap standard raster tiles) ----------
  // One map instance for the whole session. Panning and zooming only change the view; the applied search (location,
  // radius, filters) and the results never change from a gesture. The circle is a geographic overlay in metres.

  const mapLayerEl = document.getElementById('map-layer');
  let lmap = null, tiles = null, circleLayer = null, centerLayer = null, markerLayer = null;
  const mapView = { key: null, userMoved: false, fitting: false, tileOk: false, tileErrors: 0 };
  state.mapIssue = null;    // null | 'tiles' | 'script'
  function initMap() {
    if (!window.L) { state.mapIssue = 'script'; return; }
    lmap = L.map('map', { zoomControl: false, attributionControl: true, zoomSnap: 0.25, wheelPxPerZoomLevel: 90, minZoom: 6, maxZoom: 17, inertia: true });
    lmap.attributionControl.setPrefix(false);
    // OpenStreetMap standard tiles: no key or account; attribution required; light use only (OSM tile usage policy).
    tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors'
    }).addTo(lmap);
    tiles.on('tileload', () => { mapView.tileOk = true; if (state.mapIssue === 'tiles') { state.mapIssue = null; refreshMapNotice(); } });
    tiles.on('tileerror', () => { mapView.tileErrors++; if (!mapView.tileOk && mapView.tileErrors >= 4 && state.mapIssue !== 'tiles') { state.mapIssue = 'tiles'; refreshMapNotice(); announce('Map tiles didn’t load. The list still works.'); } });
    const c = loc().latLng;
    circleLayer = L.circle(c, { radius: state.radius * MILE_M, color: '#8610a8', weight: 1.5, opacity: 1, fillColor: '#8610a8', fillOpacity: 0.04, interactive: false }).addTo(lmap);
    centerLayer = L.marker(c, { icon: L.divIcon({ className: 'lf-icon map-centre', html: '<img src="assets/map/search-center.svg" alt="">', iconSize: [0, 0] }), interactive: false, keyboard: false });
    markerLayer = L.layerGroup().addTo(lmap);
    lmap.setView(c, 9.5, { animate: false });
    // Gestures that the person makes mark the view as theirs, so screen changes don't snap it back.
    lmap.on('dragstart', () => { mapView.userMoved = true; });
    lmap.on('zoomstart', () => { if (!mapView.fitting) mapView.userMoved = true; });
    lmap.on('zoomend', () => syncMarkers());
    // Tapping empty map clears a selection or open cluster (not a tap that ended a drag, or one on a marker).
    let dragged = false;
    lmap.on('dragend', () => { dragged = true; setTimeout(() => { dragged = false; }, 60); });
    mapLayerEl.addEventListener('click', e => { if (dragged && e.target.closest('.marker, .cluster')) { e.stopPropagation(); e.preventDefault(); } }, true);
    lmap.on('click', e => { if (dragged || (e.originalEvent && e.originalEvent.target.closest('.marker, .cluster'))) return; actions['map-bg'](); });
    window.addEventListener('resize', () => lmap.invalidateSize({ pan: false }));
  }
  // Fit the applied search area into the part of the map not covered by controls or the sheet.
  function fitSearchArea({ animate = false } = {}) {
    if (!lmap) return;
    const { top, h } = insets();
    const sheetY = state.screen === 'home' ? homeRestTop() : sheetTop('map');
    mapView.fitting = true;
    const done = () => { mapView.fitting = false; mapView.userMoved = false; };
    if (animate) { lmap.once('moveend', done); setTimeout(() => { if (mapView.fitting) done(); }, 900); }   // no move → no moveend
    lmap.fitBounds(circleLayer.getBounds(), { paddingTopLeft: [12, top + 52], paddingBottomRight: [12, Math.max(24, h - sheetY + 10)], animate, maxZoom: 13 });
    if (!animate) done();
  }
  // Called on every discovery render: updates the circle and markers in place; re-frames only when the applied
  // location or radius changed, or when the person hasn't moved the map and the visible area changed.
  function syncMap() {
    if (!lmap) return;
    const c = loc().latLng, key = `${state.location}|${state.radius}`;
    circleLayer.setLatLng(c).setRadius(state.radius * MILE_M);
    centerLayer.setLatLng(c);
    if (state.screen === 'home') centerLayer.remove(); else centerLayer.addTo(lmap);
    const frame = `${state.screen === 'home' ? 'home' : 'sheet'}`;
    if (key !== mapView.key) { mapView.key = key; mapView.frame = frame; fitSearchArea(); }
    else if (frame !== mapView.frame) { mapView.frame = frame; if (!mapView.userMoved) fitSearchArea(); }
    else if (state.screen === 'home' && Math.abs(homeRestTop() - (mapView.homeTop || 0)) > 6 && !mapView.userMoved) fitSearchArea();
    if (state.screen === 'home') mapView.homeTop = homeRestTop();
    const { h } = insets();
    mapLayerEl.style.setProperty('--attr-bottom', Math.max(4, h - sheetTop() + 6) + 'px');
    syncMarkers();
  }
  function keepSelectionVisible() {
    if (!lmap || state.view !== 'map' || !state.selectedListingId) return;
    const l = byId[state.selectedListingId]; if (!l) return;
    const { top, h, bottom } = insets();
    lmap.panInside(l.latLng, { paddingTopLeft: [70, top + 150], paddingBottomRight: [70, (158 + bottom) + 130] });
  }
  function refreshMapNotice() { if (isDiscovery()) refresh(); }
  function mapNotice() {
    if (!state.mapIssue) return '';
    return `<div class="map-notice" role="group" aria-labelledby="map-notice-title">
      <p class="t-sub" style="margin:0" id="map-notice-title"><b>Map didn’t load.</b> <span class="c2">${state.mapIssue === 'script' ? 'The map isn’t available right now.' : 'Map tiles couldn’t be reached.'} The list still works.</span></p>
      ${state.mapIssue === 'tiles' ? `<button type="button" class="map-retry" data-action="map-retry" data-fid="map-retry" aria-label="Retry map">Retry</button>` : ''}
    </div>`;
  }
  function mapControls() {
    return `<div class="map-controls" role="group" aria-label="Map controls">
      <button type="button" class="glass-btn map-ctl" data-action="map-zoom-in" data-fid="map-zoom-in" aria-label="Zoom in">${icon('plus-map')}</button>
      <button type="button" class="glass-btn map-ctl" data-action="map-zoom-out" data-fid="map-zoom-out" aria-label="Zoom out">${icon('minus-map')}</button>
      <button type="button" class="map-reset" data-action="map-reset" data-fid="map-reset" aria-label="Reset map to the ${state.radius}-mile search area around ${esc(loc().label)}">Reset map</button>
    </div>`;
  }

  let drag = null, suppressClick = false;
  const zoomFactor = () => { const r = appEl.getBoundingClientRect(); return r.height / appEl.offsetHeight || 1; };
  appEl.addEventListener('pointerdown', e => {
    const zone = e.target.closest('[data-drag]'), sheet = $('#dsheet');
    if (e.button > 0) return;
    // Home: a vertical drag anywhere in the sheet moves it — including over the search field and cards, whose
    // activation is cancelled once it becomes a drag. Expanded, the list scrolls natively (touch); a downward
    // drag from the top of the list is handled by the touch listener below.
    if (state.screen === 'home' && sheet && sheet.contains(e.target) && !state.overlay) {
      const list = e.target.closest('[data-scroll="list"]');
      if (state.homeSheet === 'expanded' && list && (e.pointerType !== 'mouse' || list.scrollTop > 0)) return;
      drag = { id: e.pointerId, y0: e.clientY, top0: parseFloat(sheet.style.top), moved: false, zone: sheet, home: true };
      return;
    }
    if (!zone || !sheet || !sheet.contains(zone) || state.overlay || state.screen === 'home') return;
    const ctl = e.target.closest('button, a, input, select');
    if (ctl && !ctl.classList.contains('grabber-btn')) return;
    drag = { id: e.pointerId, y0: e.clientY, top0: parseFloat(sheet.style.top), moved: false, zone };
  });
  appEl.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.id) return;
    const dy = (e.clientY - drag.y0) / zoomFactor();
    if (!drag.moved && Math.abs(dy) < 6) return;
    const sheet = $('#dsheet');
    if (!drag.moved) {
      if (!expandMapAvailable() && state.view === 'list') { drag = null; return; }
      drag.moved = true; try { drag.zone.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
      sheet.classList.add('is-dragging');
    }
    if (drag.home) {
      const { top: t } = insets(), lo = t + 88, hi = homeRestTop();
      sheet.style.top = Math.min(hi, Math.max(lo, drag.top0 + dy)) + 'px';
      e.preventDefault();
      return;
    }
    const lo = sheetTop('list'), hi = sheetTop('map');
    const top = Math.min(hi, Math.max(lo, drag.top0 + dy));
    sheet.style.top = top + 'px';
    sheet.classList.toggle('is-compact', top > hi - 70);
    e.preventDefault();
  });
  function endDrag(e) {
    if (!drag || (e && e.pointerId !== drag.id)) return;
    const d = drag; drag = null;
    if (!d.moved) return;
    suppressClick = true; setTimeout(() => { suppressClick = false; }, 0);
    const sheet = $('#dsheet');
    sheet.classList.remove('is-dragging');
    if (d.home) { settleHomeDrag(sheet, d.top0); return; }
    const top = parseFloat(sheet.style.top), lo = sheetTop('list'), hi = sheetTop('map');
    const view = top - lo > (hi - lo) / 2 ? 'map' : 'list';
    if (view === 'list') { state.selectedListingId = null; state.expandedCluster = null; state.pan = { x: 0, y: 0 }; }
    state.view = view;
    render();
    announce(view === 'map' ? 'Map in view' : 'List in view');
  }
  // A drag of 40 pt or more settles in its direction; anything shorter springs back.
  function settleHomeDrag(sheet, top0) {
    const dy = parseFloat(sheet.style.top) - top0;
    const v = dy <= -40 ? 'expanded' : dy >= 40 ? 'rest' : state.homeSheet;
    if (v === state.homeSheet) applyFrame(); else setHomeSheet(v);
  }
  // Expanded Home, touch: pulling down while the list is at its top collapses the sheet. Only that case calls
  // preventDefault; upward moves and any move once the list has scrolled stay native scrolling.
  let tdrag = null;
  appEl.addEventListener('touchstart', e => {
    tdrag = null;
    if (state.screen !== 'home' || state.homeSheet !== 'expanded' || state.overlay || e.touches.length !== 1) return;
    const list = e.target.closest('#dsheet [data-scroll="list"]');
    if (!list || list.scrollTop > 0) return;
    tdrag = { y0: e.touches[0].clientY, top0: parseFloat($('#dsheet').style.top), moved: false };
  }, { passive: true });
  appEl.addEventListener('touchmove', e => {
    if (!tdrag) return;
    const dy = (e.touches[0].clientY - tdrag.y0) / zoomFactor();
    if (!tdrag.moved) {
      if (dy < -4) { tdrag = null; return; }      // upward: let the list scroll
      if (dy < 8) return;
      tdrag.moved = true; $('#dsheet').classList.add('is-dragging');
    }
    e.preventDefault();
    const { top: t } = insets();
    $('#dsheet').style.top = Math.min(homeRestTop(), Math.max(t + 88, tdrag.top0 + dy)) + 'px';
  }, { passive: false });
  appEl.addEventListener('touchend', () => {
    const d = tdrag; tdrag = null;
    if (!d || !d.moved) return;
    suppressClick = true; setTimeout(() => { suppressClick = false; }, 0);
    const sheet = $('#dsheet'); sheet.classList.remove('is-dragging');
    settleHomeDrag(sheet, d.top0);
  });
  appEl.addEventListener('touchcancel', () => { if (tdrag && tdrag.moved) { $('#dsheet').classList.remove('is-dragging'); applyFrame(); } tdrag = null; });
  // Mouse wheel / trackpad on Home: scrolling down at rest expands; scrolling up at the top of the list collapses.
  let wheelUp = 0;
  appEl.addEventListener('wheel', e => {
    const sheet = $('#dsheet');
    if (state.screen !== 'home' || state.overlay || !sheet || !sheet.contains(e.target)) return;
    const list = sheet.querySelector('[data-scroll="list"]');
    if (state.homeSheet === 'rest' && e.deltaY > 0) { e.preventDefault(); setHomeSheet('expanded'); return; }
    if (state.homeSheet === 'expanded' && list && list.scrollTop <= 0 && e.deltaY < 0) {
      wheelUp += e.deltaY;
      if (wheelUp < -120) { wheelUp = 0; setHomeSheet('rest'); }
    } else wheelUp = 0;
  }, { passive: false });
  // Keyboard: moving focus into the listings expands the sheet so the focused card is visible.
  appEl.addEventListener('focusin', e => {
    if (state.screen === 'home' && state.homeSheet === 'rest' && e.target.closest && e.target.closest('#dsheet [data-scroll="list"]') && e.target.matches(':focus-visible')) setHomeSheet('expanded', { announceIt: false });
  });
  appEl.addEventListener('pointerup', endDrag);
  appEl.addEventListener('pointercancel', endDrag);
  appEl.addEventListener('click', e => { if (suppressClick) { e.stopPropagation(); e.preventDefault(); } }, true);

  // ---------- Search entry ----------

  function recentScopeText(sc = {}) {
    const parts = [];
    if (sc.category && sc.category !== 'cars-trucks' && sc.category !== 'all') parts.push(catLabel(sc.category));
    if (sc.location && sc.location !== state.location) parts.push(loc(sc.location).label);
    if (sc.radius && sc.radius !== state.radius) parts.push(`${sc.radius} miles`);
    if (parts.length && !parts.includes(loc(sc.location || state.location).label)) parts.splice(1, 0, loc(sc.location || state.location).label);
    if (sc.price && sc.price.max != null) parts.push(`Up to ${money(sc.price.max)}`);
    return parts.join(' · ');
  }
  function screenSearch() {
    const rows = recents.map((r, i) => {
      const title = r.query || `Browse ${catLabel((r.scope && r.scope.category) || 'cars-trucks').toLowerCase()}`;
      const sub = recentScopeText(r.scope);
      const inner = `${icon('clock')}<span class="recent-text"><span class="t-headline">${esc(title)}</span>${sub ? `<span class="t-sub c2">${esc(sub)}</span>` : ''}</span>`;
      return `<li><button type="button" class="recent-row inset-focus" data-action="search-recent" data-index="${i}" aria-label="Recent search: ${esc(title)}${sub ? ', ' + esc(sub) : ''}">${inner}</button></li>`;
    }).join('');
    return `${mapBg({ home: true })}
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
          <p class="t-sub c2" style="margin:0" id="search-scope">${esc(scopeLine())}${hasPrice() ? ' · ' + esc(priceLabel()) : ''}</p>
        </div>
        <div class="list-scroll recent-scroll is-entry">
          <div class="section-header"><h2 class="t-title3" style="margin:0">Recent searches</h2>
            ${recents.length ? `<button type="button" class="text-btn" data-action="recents-clear">Clear</button>` : ''}</div>
          ${recents.length ? `<ul class="plain-list">${rows}</ul>` : `<p class="t-sub c2" style="margin:12px 0 0">Searches you run appear here.</p>`}
        </div>
      </section>
      <div class="scroll-edge is-strong"></div>`;
  }

  // ---------- Item details ----------

  // Price-drop alerts: offered on a saved listing (star on). Simulated; nothing is delivered.
  function priceAlertCard(l, isSaved) {
    if (!isSaved) return '';
    const on = priceAlerts.includes(l.id);
    return `<div class="price-alert">
        <div class="price-alert-text"><span class="t-headline">${on ? 'Price-drop alerts on' : 'Price-drop alerts'}</span><span class="t-foot c2">${on ? 'You’ll get a notification if the price is lowered.' : 'Get a notification if the seller lowers the price.'}</span></div>
        <button type="button" class="text-btn" data-action="price-alert-toggle" data-fid="price-alert" aria-pressed="${on}" aria-label="Price-drop alerts for this listing">${on ? 'Turn off' : 'Turn on'}</button>
      </div>
      ${on && l.priceWas ? `<button type="button" class="text-btn stop-updates" data-action="stop-updates" data-fid="stop-updates">Found your car? Stop updates</button>` : ''}`;
  }
  function screenDetails() {
    const l = byId[state.details.id];
    if (sim.removedId === l.id) {
      return `<div class="details is-removed" role="dialog" aria-modal="true" aria-labelledby="removed-title">
        <div class="modal-toolbar"><button type="button" class="glass-btn" data-action="details-close" data-fid="details-close" aria-label="Close">${icon('xmark-glass')}</button></div>
        <div class="removed">
          ${state.details.fromSaved
            ? `<h1 class="t-title3" id="removed-title" style="margin:0">This listing was removed by the seller.</h1>
          <p class="t-sub c2" style="margin:0">Your saved search is kept. The other matching listings are still there.</p>
          <button type="button" class="primary-btn" data-action="details-close" data-fid="removed-back">See matching results</button>`
            : `<h1 class="t-title3" id="removed-title" style="margin:0">This listing is no longer available.</h1>
          <p class="t-sub c2" style="margin:0">Your search, filters and place in the results are kept.</p>
          <button type="button" class="primary-btn" data-action="details-close" data-fid="removed-back">Back to results</button>`}
        </div>
      </div>`;
    }
    const d = D.details[l.id] || {};
    const title = d.title || l.title;
    const isCar = l.category === 'cars-trucks';
    const facts = isCar
      ? D.factLabels.map(k => [k, (d.facts && d.facts[k]) || (k === 'Mileage' && l.miles != null ? l.detail : null)])
      : [['Details', l.detail], ['Condition', null]];
    const rows = [];
    for (let i = 0; i < facts.length; i += 2) {
      rows.push(`<div class="facts-row">${facts.slice(i, i + 2).map(([k, v]) => `<div class="fact"><span class="t-foot c2">${esc(k)}</span><span class="${v ? 't-title3' : 'fact-missing'}">${esc(v || 'Not provided')}</span></div>`).join('')}</div>`);
    }
    const count = d.photoCount || 1;
    const isSaved = saved.includes(l.id);
    const { ids } = state.details;
    const idx = ids.indexOf(l.id);
    const pickup = d.pickupMap
      ? `<img class="pm-img" src="assets/map/pickup-map.png" alt="Map of the approximate pickup area in Northeast Minneapolis">`
      : `<img class="pm-metro" src="assets/map/metro-map.png" alt="Map of the approximate pickup area in ${esc(areaName(l))}" style="left:calc(50% - ${(l.mapPx[0] * PX).toFixed(2)}px);top:${(75 - l.mapPx[1] * PX).toFixed(2)}px">`;
    return `<div class="details" role="dialog" aria-modal="true" aria-labelledby="details-title">
      <div class="details-scroll" data-scroll="details">
        <div class="gallery">
          <div class="gallery-photo">
            ${l.photo ? `<img class="gallery-img" src="${l.photo}" alt="${esc(title)}, photo 1 of ${count}">` : `<span class="no-photo is-gallery">${icon('photo')}<span>No photo provided</span></span>`}
            <span class="price-badge">${money(l.price)}</span>
            ${l.photo ? `<span class="photo-counter">Photo 1 of ${count}</span>` : ''}
          </div>
          ${l.photo && count > 1 ? `<div class="dots" aria-hidden="true">${Array.from({ length: count }, (_, i) => `<span class="${i ? '' : 'is-current'}"></span>`).join('')}</div>` : ''}
        </div>
        <div class="title-block">
          <h1 class="t-title1" id="details-title" style="margin:0">${esc(title)}</h1>
          <p class="t-sub c2" style="margin:0">Posted ${ago(l)}${l.seller ? ` • By ${l.seller.toLowerCase()}` : ''}</p>
          ${l.priceWas ? `<p class="t-sub-e price-drop-line" style="margin:0">Price lowered from ${money(l.priceWas)} on ${fmtDate(l.priceDropOn)}</p>` : ''}
        </div>
        ${priceAlertCard(l, isSaved)}
        <div class="facts" role="group" aria-label="Seller-provided details">${rows.join('')}<p class="t-foot c2" style="margin:0">Seller-provided details</p></div>
        ${d.description ? `<div class="desc"><h2 class="t-title3" style="margin:0">Description</h2><p class="t-body" style="margin:0">${esc(d.description)}</p><p class="t-foot c2" style="margin:0">Seller’s text, shown as written</p></div>` : ''}
        <div class="pickup">
          <h2 class="t-title3" style="margin:0">Approximate pickup area</h2>
          <div><p class="t-body" style="margin:0">${esc(areaName(l))}</p><p class="t-sub c2" style="margin:0">General area only, not an exact address. The seller shares the meeting location when you arrange a time.</p></div>
          <div class="pickup-map">${pickup}<img class="pm-area" src="assets/map/pickup-area-fill.svg" alt=""></div>
          ${unavailable('open-maps', `${icon('map-purple', 'om-map')}<span>Open in Maps</span>${icon('external', 'om-ext')}`, 'Open in Maps')}
        </div>
        <div class="details-end" aria-hidden="true"></div>
      </div>
      <div class="details-fade-top"></div>
      <div class="modal-toolbar">
        <button type="button" class="glass-btn" data-action="details-close" data-fid="details-close" aria-label="Close">${icon('xmark-glass')}</button>
        <button type="button" class="glass-btn" data-action="toggle-save" data-fid="save-star" aria-pressed="${isSaved}" aria-label="Save to Favorites">${icon(isSaved ? 'star-fill' : 'star-outline')}</button>
      </div>
      ${ids.length > 1 ? `<div class="listing-nav">
        <button type="button" class="glass-btn" data-action="details-step" data-dir="-1" data-fid="details-prev" aria-label="Previous listing" ${idx <= 0 ? 'disabled' : ''}>${icon('chevron-left')}</button>
        <span class="t-sub-e" aria-live="polite">Listing ${idx + 1} of ${ids.length}</span>
        <button type="button" class="glass-btn" data-action="details-step" data-dir="1" data-fid="details-next" aria-label="Next listing" ${idx >= ids.length - 1 ? 'disabled' : ''}>${icon('chevron-right')}</button>
      </div>` : ''}
      <div class="contact-fade"></div>
      <div class="contact">
        <p class="t-sub c2" style="margin:0">Confirm availability and the meeting location with the seller. Inspect the ${isCar ? 'vehicle' : 'item'} before paying.</p>
        ${unavailable('primary-btn', 'Contact seller', 'Contact seller')}
      </div>
    </div>`;
  }

  const SCREENS = { home: screenDiscovery, browse: screenDiscovery, results: screenDiscovery, search: screenSearch, details: screenDetails };

  // ---------- Sheets and menus ----------

  // Modal sheet: header (title, Close, grabber), scrolling body, and an optional footer that stays in view
  // above the keyboard and the home indicator.
  function sheetFrame(title, body, { cls = 'psheet', footer = '', label } = {}) {
    return `<div class="scrim anim-fade" data-action="sheet-close"></div>
      <div class="${cls} surface-sheet anim-sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title">
        <div class="psheet-header">
          <h2 class="t-title3" id="sheet-title" style="margin:0">${esc(title)}</h2>
          <button type="button" class="glass-btn" data-action="sheet-close" aria-label="${esc(label || `Close ${title.toLowerCase()} without applying`)}">${icon('xmark-glass')}</button>
          <div class="grabber" aria-hidden="true"></div>
        </div>
        <div class="sheet-body">${body}</div>
        ${footer ? `<div class="sheet-footer">${footer}</div>` : ''}
      </div>`;
  }
  // Footer: secondary actions in one row (Clear on the left, Cancel on the right), Apply below.
  function sheetFooter({ clear, apply, applyDisabled = false }) {
    return `<div class="footer-row">
        ${clear ? `<button type="button" class="text-btn" data-action="${clear.action}" ${clear.disabled ? 'disabled' : ''}>${esc(clear.label)}</button>` : '<span></span>'}
        <button type="button" class="text-btn" data-action="sheet-close">Cancel</button>
      </div>
      <button type="button" class="primary-btn" data-action="${apply.action}" data-apply ${applyDisabled ? 'disabled' : ''}>${esc(apply.label)}</button>`;
  }
  const showLabel = n => n ? `Show ${plural(n, 'result')}` : 'Show 0 results';
  function crow({ action, id, label, selected, chevron, last, sub, disabled }) {
    const inner = `<span class="crow-label">${esc(label)}${sub ? ` <span class="crow-sub">${esc(sub)}</span>` : ''}</span>${selected ? icon('checkmark', 'ic-check') : ''}${chevron ? icon('chevron', 'ic-chevron') : ''}`;
    const cls = `crow t-body ${selected ? 'is-selected' : ''} ${last ? 'no-sep' : ''}`;
    if (disabled) return `<li>${unavailable(cls, inner, label)}</li>`;
    return `<li><button type="button" class="${cls} inset-focus" data-action="${action}" data-id="${esc(id)}" aria-current="${!!selected}">${inner}</button></li>`;
  }

  // Category picker: every for-sale category works on the sample data; sections with subcategories aren't built.
  function sheetCategory() {
    const row = (c, last) => crow({ action: 'category-pick', id: c.id, label: c.label, selected: c.id === state.category, chevron: c.chevron, last, disabled: !!c.chevron });
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
  // Location and proximity pickers. Not designed in Figma: built from the Category Row, Price Input, Sheet Surface
  // and Primary Button components. Both edit a draft; Apply commits it and Cancel/Close/Esc/scrim discard it.
  const norm = v => v.toLowerCase().replace(/\bsaint\b/g, 'st').replace(/[^a-z0-9]+/g, ' ').trim();
  function locationMatches(q) {
    const n = norm(q || '');
    if (!n) return D.locations;
    return D.locations.filter(l => norm(l.label).startsWith(n) || norm(l.label).split(' ').some(w => w.startsWith(n)) || l.zip.startsWith(n.replace(/ /g, '')));
  }
  function locationHint(q, list) {
    if (!q.trim()) return `${plural(D.locations.length, 'supported location')}. Type a city or a 5-digit ZIP code to narrow the list.`;
    if (!list.length) {
      const zip = /^\d{5}$/.test(q.trim());
      return `${zip ? `ZIP ${q.trim()}` : `“${q.trim()}”`} isn’t available in this prototype. Try Minneapolis, St. Paul, Edina or Bloomington, or their ZIP codes.`;
    }
    return `${plural(list.length, 'match', 'matches')} for “${q.trim()}”.`;
  }
  function locationRows(list) {
    return list.map((l, i) => crow({ action: 'location-pick', id: l.id, label: l.label, sub: l.zip + (l.id === state.location ? ' · current' : ''), selected: l.id === state.draftLocation, last: i === list.length - 1 })).join('');
  }
  function sheetLocation() {
    const q = state.overlay.locQuery || '', list = locationMatches(q), cur = loc();
    const changed = state.draftLocation !== state.location;
    return sheetFrame('Location', `<p class="t-foot c2" id="loc-context" style="margin:0">Search location: <b style="color:var(--label);font-weight:600">${esc(cur.label)} ${esc(cur.zip)}</b>. Listings are found around this point. Your device location isn’t used.</p>
      <form class="price-field" data-form="location" action="#" novalidate role="search">
        <label class="t-sub-e c2" for="loc-input">City or ZIP code</label>
        <div class="money ${q ? 'has-value' : ''}">
          ${icon('search', 'money-icon')}
          <input id="loc-input" class="t-body" type="text" autocomplete="off" autocapitalize="words" spellcheck="false" enterkeyhint="search"
            placeholder="Minneapolis or 55401" value="${esc(q)}" data-loc aria-describedby="loc-hint" aria-controls="loc-list">
        </div>
        <button type="submit" hidden tabindex="-1"></button>
      </form>
      <p class="t-foot c2" id="loc-hint" role="status" style="margin:-8px 0 0">${esc(locationHint(q, list))}</p>
      <ul class="plain-list list-inset" id="loc-list" aria-label="Supported locations">${locationRows(list)}</ul>`,
      { cls: 'psheet is-tall', footer: sheetFooter({ apply: { action: 'location-apply', label: changed ? `Search ${loc(state.draftLocation).label} · ${showLabel(compute({ location: state.draftLocation }).length)}` : 'Done' } }) });
  }

  // Radius preview: the supplied metro map, centred on the (draft) search centre, zoomed so the whole circle fits.
  // Dots: the listings the current query, category and filters would show (inside = purple, outside = grey).
  const MAP_W = 1114 * PX, MAP_H = 1826 * PX, PREVIEW_H = 168;
  function radiusPreviewModel(radius = state.draftRadius) {
    const c = loc().px, r = radius * D.PX_PER_MILE * PX;
    const s = Math.min(1, (PREVIEW_H / 2 - 12) / r);
    const all = showsMarkers() ? compute({ radius: 1e9 }) : [];
    const inside = new Set(compute({ radius }).map(l => l.id));
    return { s, cx: c[0] * PX, cy: c[1] * PX, r, dots: all.map(l => ({ x: l.mapPx[0] * PX, y: l.mapPx[1] * PX, on: inside.has(l.id) })) };
  }
  function radiusPreview() {
    const m = radiusPreviewModel();
    return `<div class="radius-preview" aria-hidden="true" style="height:${PREVIEW_H}px">
      <div class="rp-world" style="width:${MAP_W.toFixed(1)}px;height:${MAP_H.toFixed(1)}px;transform:scale(${m.s.toFixed(4)}) translate(${(-m.cx).toFixed(1)}px,${(-m.cy).toFixed(1)}px)">
        <img src="assets/map/metro-map.png" alt="" class="rp-img">
        <svg class="rp-svg" width="${MAP_W.toFixed(1)}" height="${MAP_H.toFixed(1)}" viewBox="0 0 ${MAP_W.toFixed(1)} ${MAP_H.toFixed(1)}">
          ${m.dots.map(d => `<circle class="rp-dot ${d.on ? 'is-on' : ''}" cx="${d.x.toFixed(1)}" cy="${d.y.toFixed(1)}" r="${(4 / m.s).toFixed(1)}"/>`).join('')}
          <circle class="rp-circle" cx="${m.cx.toFixed(1)}" cy="${m.cy.toFixed(1)}" r="${m.r.toFixed(1)}" vector-effect="non-scaling-stroke"/>
          <circle class="rp-centre" cx="${m.cx.toFixed(1)}" cy="${m.cy.toFixed(1)}" r="${(6 / m.s).toFixed(1)}" vector-effect="non-scaling-stroke"/>
        </svg>
      </div>
    </div>`;
  }
  function radiusCaption(r = state.draftRadius) {
    const n = compute({ radius: r }).length;
    return `Preview: ${r} miles around ${loc().label} ${loc().zip} · ${plural(n, state.query ? 'result' : 'listing')} inside`;
  }
  function sheetRadius() {
    const r = state.draftRadius;
    const rows = D.radii.map((d, i) => crow({ action: 'radius-pick', id: String(d), label: `Within ${d} miles`, sub: d === state.radius ? 'current' : '', selected: d === r, last: i === D.radii.length - 1 })).join('');
    return sheetFrame('Distance', `<p class="t-foot c2" style="margin:0">Straight-line distance from the search location, ${esc(loc().label)} ${esc(loc().zip)}, to each listing’s approximate (illustrative) location.</p>
      ${radiusPreview()}
      <p class="t-foot c2" id="radius-caption" role="status" style="margin:-8px 0 0">${esc(radiusCaption())}</p>
      <ul class="plain-list list-inset" id="radius-list" aria-label="Distance options">${rows}</ul>`,
      { cls: 'psheet is-tall', footer: sheetFooter({ apply: { action: 'radius-apply', label: r !== state.radius ? `Use ${r} miles · ${showLabel(compute({ radius: r }).length)}` : 'Done' } }) });
  }

  function numField(key, label, ph, val, { prefix = '$', group = 'price', format = true } = {}) {
    return `<div class="price-field">
      <label class="t-sub-e c2" for="${group}-${key}">${label}</label>
      <div class="money ${val != null ? 'has-value' : ''}">
        ${prefix ? `<span class="money-sym t-body" aria-hidden="true">${prefix}</span>` : ''}
        <input id="${group}-${key}" class="t-body" type="text" inputmode="numeric" pattern="[0-9,]*" autocomplete="off" enterkeyhint="done"
          placeholder="${ph}" value="${val == null ? '' : (format ? val.toLocaleString('en-US') : val)}" data-num="${group}.${key}" aria-describedby="${group}-error sheet-context">
      </div>
    </div>`;
  }
  const contextLine = extra => `<p class="t-foot c2" id="sheet-context" style="margin:0">${esc([state.query, catLabel(state.category), loc().label, `${state.radius} miles`, extra].filter(Boolean).join(' · '))}</p>`;
  const priceError = p => p.min != null && p.max != null && p.min > p.max ? 'Minimum is higher than maximum.' : '';
  function yearError(x) {
    const { min, max } = D.yearBounds;
    const out = v => v != null && (v < min || v > max);
    if (out(x.yearMin) || out(x.yearMax)) return `Enter a year between ${min} and ${max}.`;
    if (x.yearMin != null && x.yearMax != null && x.yearMin > x.yearMax) return '“From” year is later than “To” year.';
    return '';
  }

  function sheetPrice() {
    const p = state.price.draft, err = priceError(p);
    return sheetFrame('Price', `${contextLine()}
      <form class="price-fields" data-form="price" action="#" novalidate>
        ${numField('min', 'Minimum', 'No min', p.min)}${numField('max', 'Maximum', 'No max', p.max)}
        <button type="submit" hidden tabindex="-1"></button>
      </form>
      <p class="t-foot field-error" id="price-error" role="alert" ${err ? '' : 'hidden'}>${esc(err)}</p>`,
      { footer: sheetFooter({ clear: { action: 'price-clear', label: 'Clear price', disabled: !hasPrice(p) }, apply: { action: 'price-apply', label: 'Apply' }, applyDisabled: !!err }) });
  }

  function segmented(name, label, options, value) {
    return `<fieldset class="seg-group"><legend class="t-headline">${label}</legend>
      <div class="segmented" role="radiogroup" aria-label="${label}">
        ${options.map(o => `<label class="seg ${o.id === value ? 'is-on' : ''}"><input type="radio" name="${name}" value="${o.id == null ? '' : o.id}" ${o.id === value ? 'checked' : ''}><span>${esc(o.label)}</span></label>`).join('')}
      </div></fieldset>`;
  }
  function selectField(key, label, options, value, { disabled = false, anyLabel } = {}) {
    return `<div class="price-field">
      <label class="t-sub-e c2" for="extras-${key}">${label}</label>
      <div class="money select-surface ${disabled ? 'is-disabled' : ''}">
        <select id="extras-${key}" class="t-body" data-select="${key}" ${disabled ? 'disabled aria-disabled="true"' : ''}>
          <option value="">${esc(anyLabel)}</option>
          ${options.map(o => `<option value="${esc(o)}" ${o === value ? 'selected' : ''}>${esc(o)}</option>`).join('')}
        </select>
        ${icon('caret-down', 'ic-caret')}
      </div>
    </div>`;
  }
  const draftCount = () => compute({ price: state.price.draft, extras: state.extras.draft }).length;
  const draftEmpty = () => !hasPrice(state.price.draft) && JSON.stringify(activeExtras(state.extras.draft)) === JSON.stringify(noExtras());
  // Listings hidden only because the seller didn't state a detail that a draft filter needs.
  function missingNote() {
    const x = activeExtras(state.extras.draft), price = state.price.draft;
    const field = (on, key, label) => {
      if (!on) return null;
      const without = { ...x };
      if (key === 'year') { without.yearMin = null; without.yearMax = null; } else if (key === 'miles') without.mileage = null; else without.seller = null;
      const n = compute({ price, extras: without }).filter(l => l[key] == null).length;
      return n ? `${plural(n, 'listing')} without ${label}` : null;
    };
    const parts = [field(!!x.seller, 'seller', 'a seller type'), field(x.yearMin != null || x.yearMax != null, 'year', 'a year'), field(!!x.mileage, 'miles', 'mileage')].filter(Boolean);
    return parts.length ? `Hidden because the detail isn’t stated: ${parts.join(' · ')}.` : '';
  }
  function filtersApplyLabel() {
    if (priceError(state.price.draft)) return 'Fix the price to apply';
    if (isCars() && yearError(state.extras.draft)) return 'Fix the year to apply';
    return showLabel(draftCount());
  }
  // Filters: price (also on its own pill), seller type and, in Cars & trucks, vehicle year, mileage, make and model.
  // Figma (4d) designs seller type and mileage; price, year and make/model reuse the Price Input and Category Row parts.
  function sheetFilters() {
    const x = state.extras.draft, p = state.price.draft;
    const cars = isCars();
    const pErr = priceError(p), yErr = cars ? yearError(x) : '';
    const models = x.make ? D.makeModels[x.make] : [];
    const vehicle = cars ? `
        <fieldset class="seg-group"><legend class="t-headline">Vehicle year</legend>
          <div class="price-fields">${numField('yearMin', 'From', 'Any', x.yearMin, { prefix: '', group: 'extras', format: false })}${numField('yearMax', 'To', 'Any', x.yearMax, { prefix: '', group: 'extras', format: false })}</div>
          <p class="t-foot field-error" id="extras-error" role="alert" ${yErr ? '' : 'hidden'}>${esc(yErr)}</p>
        </fieldset>
        ${segmented('mileage', 'Mileage', D.mileages, x.mileage)}
        <fieldset class="seg-group"><legend class="t-headline">Make and model</legend>
          <div class="price-fields">
            ${selectField('make', 'Make', Object.keys(D.makeModels), x.make, { anyLabel: 'Any make' })}
            ${selectField('model', 'Model', models, x.model, { disabled: !x.make, anyLabel: x.make ? 'Any model' : 'Pick a make' })}
          </div>
        </fieldset>` : `<p class="t-foot c2" style="margin:0">Vehicle year, mileage and make and model are available in Cars &amp; trucks.</p>`;
    const note = missingNote();
    return sheetFrame('Filters', `${contextLine()}
      <form class="filters-form" data-form="filters" action="#" novalidate>
        <fieldset class="seg-group"><legend class="t-headline">Price</legend>
          <div class="price-fields">${numField('min', 'Minimum', 'No min', p.min)}${numField('max', 'Maximum', 'No max', p.max)}</div>
          <p class="t-foot field-error" id="price-error" role="alert" ${pErr ? '' : 'hidden'}>${esc(pErr)}</p>
        </fieldset>
        ${segmented('seller', 'Seller type', D.sellers, x.seller)}
        ${vehicle}
        <p class="t-foot c2" style="margin:0">Listings that don’t state a detail are hidden while a filter on that detail is on.</p>
        <p class="t-foot missing-note" id="missing-note" ${note ? '' : 'hidden'}>${esc(note)}</p>
        <button type="submit" hidden tabindex="-1"></button>
      </form>`, { cls: 'psheet is-tall', footer: sheetFooter({ clear: { action: 'filters-clear', label: 'Clear all', disabled: draftEmpty() }, apply: { action: 'filters-apply', label: filtersApplyLabel() }, applyDisabled: !!(pErr || yErr) }) });
  }

  function menuSort() {
    const r = state.overlay.rect, appRect = appEl.getBoundingClientRect();
    const zoom = appRect.width / appEl.offsetWidth || 1;
    const top = (r.bottom - appRect.top) / zoom + 6, right = Math.max((appRect.right - r.right) / zoom, 12);
    return `<div class="menu-catcher" data-action="sheet-close"></div>
      <div class="menu anim-fade" role="menu" aria-label="Sort" style="top:${top.toFixed(0)}px;right:${right.toFixed(0)}px">
        ${D.sorts.map(s => `<button type="button" class="menu-item" role="menuitemradio" aria-checked="${s.id === state.sort}" data-action="sort-pick" data-id="${s.id}"><span>${esc(s.label)}</span>${s.id === state.sort ? icon('checkmark', 'ic-check') : ''}</button>`).join('')}
      </div>`;
  }

  // Save search (R1) and Manage saved search (R9).
  const alertSeg = v => segmented('alerts', 'New-match alerts', ALERTS, v);
  function sheetSave() {
    return sheetFrame('Save this search', `<p class="t-foot c2" style="margin:0">Saves: ${esc(searchContext(criteria()))}</p>
      <form class="filters-form" data-form="save-search" action="#" novalidate>${alertSeg(state.overlay.alerts)}<button type="submit" hidden tabindex="-1"></button></form>
      <p class="t-foot c2" style="margin:0">Alerts are optional. Your search stays saved either way.</p>`,
      { label: 'Close without saving', footer: `<button type="button" class="primary-btn" data-action="save-search-confirm" data-fid="save-confirm">Save search</button>` });
  }
  function sheetManage() {
    const ss = savedSearches.find(x => x.id === state.overlay.id);
    const alertIds = priceAlerts.filter(id => compute(ss.crit).some(l => l.id === id));
    return sheetFrame('Saved search', `<p class="t-foot c2" style="margin:0">${esc(searchContext(ss.crit))}</p>
      <form class="filters-form" data-form="manage-search" action="#" novalidate>${alertSeg(state.overlay.alerts)}<button type="submit" hidden tabindex="-1"></button></form>
      <p class="t-foot c2" style="margin:0">Off pauses alerts. Your search stays saved until you remove it.${alertIds.map(id => ` Price-drop alerts for ${esc(byId[id].title)}: on (change on the listing).`).join('')}</p>
      <p class="t-sub c2" style="margin:0">Found a car? Remove the search to stop all updates.</p>
      <button type="button" class="text-btn is-destructive" data-action="manage-remove" data-fid="manage-remove">Remove saved search</button>`,
      { label: 'Close without changes', footer: `<button type="button" class="primary-btn" data-action="manage-done" data-fid="manage-done">Done</button>` });
  }

  const SHEETS = { save: sheetSave, manage: sheetManage, category: sheetCategory, location: sheetLocation, radius: sheetRadius, price: sheetPrice, filters: sheetFilters, sort: menuSort };
  const isMenu = o => o && o.type === 'sort';

  // ---------- Rendering ----------

  function render({ resetScroll = false, overlay = true } = {}) {
    const prevList = $('[data-scroll="list"]'), prevFilters = $('.filters');
    const keep = !resetScroll && isDiscovery() && appEl.dataset.screen && isDiscovery(appEl.dataset.screen);
    const listY = keep && prevList ? prevList.scrollTop : 0, filterX = keep && prevFilters ? prevFilters.scrollLeft : 0;
    const a = document.activeElement, hadFocus = a && screenEl.contains(a) ? (a.dataset.fid || (a.id ? '#' + a.id : null)) : null;
    screenEl.innerHTML = SCREENS[state.screen]();
    appEl.classList.toggle('on-home', state.screen === 'home');
    appEl.dataset.screen = state.screen;
    if (isDiscovery()) {
      applyFrame({ animate: false });
      const list = $('[data-scroll="list"]'), filters = $('.filters');
      if (list) list.scrollTop = listY;
      if (filters) filters.scrollLeft = filterX;
    } else { delete appEl.dataset.view; if (markerLayer) markerLayer.clearLayers(); }
    appEl.dataset.screen = state.screen;
    if (overlay) renderOverlay();
    return hadFocus;
  }
  // Re-draw the results after a network event without touching an open sheet, the search screen or focus.
  // If the focused control disappeared (e.g. Retry after success), focus moves to the status or results heading.
  function refresh({ resetScroll = false } = {}) {
    if (!isDiscovery()) return;
    const had = render({ resetScroll, overlay: false });
    if (!had || state.overlay) return;
    const el = had.startsWith('#') ? $(had) : appEl.querySelector(`[data-fid="${had}"]`);
    if (el && el.offsetParent !== null && el.getAttribute('aria-disabled') !== 'true') el.focus({ preventScroll: true });
    else { const h = $('#net-title') || $('#results-count'); if (h) h.focus({ preventScroll: true }); }
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
    if (el && !el.disabled && el.getAttribute('aria-disabled') !== 'true' && el.offsetParent !== null) { el.focus({ preventScroll: true }); return true; }
    return false;
  }
  function focusFirst(c) {
    const el = c && [...c.querySelectorAll('button:not([tabindex="-1"]):not([disabled]), input, select, textarea, a[href]')].find(e => e.offsetParent !== null && e.getAttribute('aria-disabled') !== 'true');
    if (el) el.focus({ preventScroll: true });
  }

  function snapshot(fid) {
    const list = $('[data-scroll="list"]'), filters = $('.filters');
    return { screen: state.screen, view: state.view, homeSheet: state.homeSheet, pan: { ...state.pan }, selectedListingId: state.selectedListingId, expandedCluster: state.expandedCluster,
      listScrollY: list ? list.scrollTop : 0, filterRowScrollX: filters ? filters.scrollLeft : 0, fid };
  }
  function restore(snap) {
    Object.assign(state, { screen: snap.screen, view: snap.view || 'list', homeSheet: snap.homeSheet || 'rest', pan: snap.pan || { x: 0, y: 0 }, selectedListingId: snap.selectedListingId, expandedCluster: snap.expandedCluster || null });
    if (state.selectedListingId && !shown().some(l => l.id === state.selectedListingId)) state.selectedListingId = null;
    render({ resetScroll: true });
    const list = $('[data-scroll="list"]'), filters = $('.filters');
    if (list) list.scrollTop = snap.listScrollY;
    if (filters) filters.scrollLeft = snap.filterRowScrollX;
    if (!focusFid(snap.fid)) focusFirst(screenEl);
  }
  function scrollFiltersTo(fid) {
    const filters = $('.filters'); if (!filters) return;
    const el = fid && filters.querySelector(`[data-fid="${fid}"]`);
    if (!el) { filters.scrollLeft = 0; return; }
    const pill = el.closest('.pill');
    filters.scrollLeft = Math.max(0, pill.offsetLeft + pill.offsetWidth + 16 - filters.clientWidth);
  }
  function showList(fid) {
    state.screen = listScreen();
    state.view = 'list'; state.homeSheet = 'rest';
    state.selectedListingId = null; state.expandedCluster = null; state.pan = { x: 0, y: 0 };
    request({ fresh: true });
    scrollFiltersTo(hasPrice() ? 'pill-price' : null);
    if (!focusFid(fid)) focusFirst(screenEl);
  }
  // After an applied change (filters, location, proximity, price): same screen and view, new request.
  function rerun(focus, { scrollTo } = {}) {
    state.expandedCluster = null; state.pan = { x: 0, y: 0 };
    request({ fresh: true });
    if (scrollTo !== undefined) scrollFiltersTo(scrollTo);
    if (!focusFid(focus)) focusFirst(screenEl);
  }

  // ---------- Simulated request lifecycle ----------
  // One lifecycle for every search: loading → (slow notice) → success | failed. Retry starts it again.
  // Starting a request cancels the timers of any older one, and responses check their id, so an older response
  // can never overwrite a newer search.

  let reqSeq = 0, reqTimers = [];
  const later = (fn, ms) => { reqTimers.push(setTimeout(fn, ms)); };
  function cancelRequests() { reqTimers.forEach(clearTimeout); reqTimers = []; }
  const isCurrent = id => state.req && state.req.id === id;
  function request({ fresh = false, retry = false } = {}) {
    const crit = criteria(), key = critKey(crit);
    cancelRequests();
    // Nothing to fetch: the results on screen already match (e.g. a change was undone).
    if (!retry && state.results && state.results.key === key) { state.req = null; refresh({ resetScroll: fresh }); return; }
    const id = ++reqSeq;
    state.req = { id, key, crit, status: 'loading', retry };
    state.selectedListingId = null;
    refresh({ resetScroll: true });
    const slow = sim.network === 'slow';
    if (slow) later(() => {
      if (!isCurrent(id)) return;
      state.req.status = 'slow';
      refresh();
      announce('Taking longer than usual. Your search is still running.');
    }, TIMING.slowNotice);
    later(() => {
      if (!isCurrent(id)) return;                                  // superseded: ignore
      if (sim.network === 'fail' && sim.failArmed) { sim.failArmed = false; syncSimControls(); fail(id); return; }
      succeed(id);
    }, slow ? TIMING.slowResponse : TIMING.response);
  }
  function fail(id) {
    state.req.status = 'failed';
    refresh();
    announce('Couldn’t load listings. Your search and filters are saved.');
  }
  function succeed(id) {
    const r = state.req;
    state.results = { crit: r.crit, key: r.key };
    state.req = null;
    refresh({ resetScroll: true });
    const n = shown().length;
    announce((r.retry ? 'Listings updated. ' : '') + (n ? plural(n, state.query ? 'result' : 'listing') : 'No listings match your search.'));
  }

  // ---------- Overlays ----------

  function openOverlay(type, trigger, extra = {}) {
    if (type === 'price') state.price.draft = { ...state.price.applied };     // drafts copy applied values
    if (type === 'filters') { state.extras.draft = { ...state.extras.applied }; state.price.draft = { ...state.price.applied }; }
    state.draftLocation = state.location; state.draftRadius = state.radius;
    state.overlay = { type, focusReturn: trigger && trigger.dataset.fid, rect: trigger ? trigger.getBoundingClientRect() : null, ...extra };
    renderOverlay();
    if (type === 'sort') { trigger.setAttribute('aria-expanded', 'true'); (overlayEl.querySelector('[aria-checked="true"]') || overlayEl.querySelector('.menu-item')).focus(); return; }
    if (type === 'price' && !hasPrice()) { $('#price-max').focus(); return; }
    const sel = overlayEl.querySelector('.crow.is-selected, .seg.is-on input');
    if (sel) sel.focus(); else focusFirst(overlayEl.querySelector('[role="dialog"]'));
  }
  function closeOverlay() {
    const fid = state.overlay && state.overlay.focusReturn;
    state.overlay = null;                                   // discard drafts
    state.price.draft = { ...state.price.applied };
    state.extras.draft = { ...state.extras.applied };
    state.draftLocation = state.location; state.draftRadius = state.radius;
    renderOverlay();
    const t = fid && appEl.querySelector(`[data-fid="${fid}"]`);
    if (t && t.hasAttribute('aria-expanded')) t.setAttribute('aria-expanded', 'false');
    focusFid(fid);
  }
  function dismissOverlay() { state.overlay = null; renderOverlay(); }
  function rerenderDetails(fid) {
    const sc = $('.details-scroll'), y = sc ? sc.scrollTop : 0;
    render({ overlay: false });
    const n = $('.details-scroll'); if (n) n.scrollTop = y;
    focusFid(fid);
  }

  // ---------- Saved searches (exploration · returning to a car search) ----------

  let toastTimer = null;
  function showSavedToast(id) {
    state.savedToast = id; refresh();
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { state.savedToast = null; refresh(); }, 8000);
  }
  // Restore a saved search: query, category, location, radius and every applied filter. New matches are counted
  // from when it was last viewed; viewing it now resets that point.
  function openSavedSearch(ss, { focus = 'search-field' } = {}) {
    const c = ss.crit;
    state.savedView = { id: ss.id, newIds: newSince(ss).map(l => l.id), since: ss.lastViewedAt };
    ss.lastViewedAt = Date.now(); persistSaved();
    state.overlay = null; renderOverlay();
    state.details = null; state.returnTo = null; state.searchReturn = null; state.savedToast = null;
    state.query = c.query; setCategory(c.category);
    state.location = c.location; state.radius = c.radius;
    state.price.applied = { ...c.price }; state.price.draft = { ...c.price };
    state.extras.applied = { ...noExtras(), ...c.extras }; state.extras.draft = { ...state.extras.applied };
    showList(focus);
    return ss;
  }

  // ---------- Example notifications (simulated; nothing is delivered) ----------

  const notifEl = document.getElementById('notif');
  let notif = null;
  function showNotification(n) {
    notif = n;
    notifEl.innerHTML = `<div class="notif-scrim" data-action="notif-dismiss"></div>
      <div class="notif-stack">
        <button type="button" class="notif" data-action="notif-open" data-fid="notif" aria-label="Example notification. ${esc(n.title)}. ${esc(n.body)}. Open">
          <span class="notif-icon" aria-hidden="true"></span>
          <span class="notif-text"><span class="notif-app">Craigslist · now</span><b>${esc(n.title)}</b><span>${esc(n.body)}</span></span>
        </button>
        <p class="notif-caption">Example notification · delivery not implemented</p>
      </div>`;
    notifEl.hidden = false;
    notifEl.querySelector('.notif').focus({ preventScroll: true });
    announce(`Example notification: ${n.title}. ${n.body}`);
  }
  function hideNotification() { notif = null; notifEl.hidden = true; notifEl.innerHTML = ''; }
  function openNotification() {
    const n = notif; hideNotification();
    if (!n) return;
    if (n.kind === 'new') { const ss = savedSearches.find(x => x.id === n.ssId); if (ss) openSavedSearch(ss); return; }
    // Price drop: the same saved listing, opened inside the saved search it belongs to (Close returns there).
    const ss = savedSearches.find(x => compute(x.crit).some(l => l.id === n.id));
    if (ss) openSavedSearch(ss);
    else if (!isDiscovery()) { state.overlay = null; renderOverlay(); state.details = null; state.screen = listScreen(); render({ resetScroll: true }); }
    const ids = compute().map(l => l.id);
    state.returnTo = snapshot('card-' + n.id);
    state.details = { id: n.id, ids: ids.includes(n.id) ? ids : [n.id], fromSaved: ss ? ss.id : null };
    state.screen = 'details';
    render({ overlay: false });
    focusFid('details-close');
  }

  // Demo events (desktop "Saved-search demo" controls, URL ?demo=new-match|price-drop, or CL_PROTO.demo()).
  const demoStatus = msg => { const el = document.getElementById('demo-status'); if (el) el.textContent = msg; };
  function demoEvent(kind) {
    if (kind === 'reset') {
      demo = { newInventory: false, addedAt: 0, priceDrop: null }; applyDemo();
      savedSearches = []; persistSaved(); priceAlerts = []; persistAlerts();
      state.savedView = null; state.savedToast = null; hideNotification();
      // Back to the default search area: Minneapolis 55401, 25 miles (never the device's location).
      const moved = state.location !== 'mpls' || state.radius !== 25;
      state.location = state.draftLocation = 'mpls'; state.radius = state.draftRadius = 25;
      if (state.screen === 'details') rerenderDetails('details-close');
      else if (moved && isDiscovery()) request({ fresh: true }); else refresh();
      demoStatus('Demo reset: Minneapolis, 25 miles; no saved searches or alerts; original inventory and prices.');
      return;
    }
    if (kind === 'new-match') {
      demo.newInventory = true; demo.addedAt = Date.now(); applyDemo();
      if (isDiscovery()) refresh();
      const ss = savedSearches.find(x => compute(x.crit).some(l => l.id === 'L14'));
      if (!ss) { demoStatus('Added a 2015 VW Golf in Golden Valley. No saved search matches it, so there is no notification.'); return; }
      const n = newSince(ss).length;
      if (ss.alerts === 'off') { demoStatus(`Added a 2015 VW Golf. Alerts are off for “${searchLabel(ss.crit)}”, so there is no notification; Home shows ${n} new.`); return; }
      demoStatus(`Added a 2015 VW Golf. Showing the ${alertsLabel(ss.alerts).toLowerCase()} alert as an example notification.`);
      showNotification({ kind: 'new', ssId: ss.id, title: 'New match for your saved search', body: `${searchLabel(ss.crit)}: ${plural(n, 'new listing')}` });
      return;
    }
    if (kind === 'price-drop') {
      demo.priceDrop = { id: 'L01', from: 8900, to: 8500, on: Date.now() }; applyDemo();
      if (state.screen === 'details') rerenderDetails('details-close'); else if (isDiscovery()) refresh();
      if (!priceAlerts.includes('L01')) { demoStatus('2016 VW Golf lowered to $8,500. Its price-drop alerts are off (save it, then turn them on in its details), so there is no notification.'); return; }
      demoStatus('2016 VW Golf lowered to $8,500. Showing the price-drop alert as an example notification.');
      showNotification({ kind: 'drop', id: 'L01', title: 'Price lowered: 2016 VW Golf', body: '$8,900 → $8,500 · Northeast' });
    }
  }


  // ---------- Price apply ----------

  function applyPrice(price, focus = 'pill-price') {
    dismissOverlay();
    state.price.applied = { ...price }; state.price.draft = { ...price };
    rerun(focus, { scrollTo: hasPrice() ? 'pill-price' : null });
  }

  // ---------- Search ----------

  function openSearch(fid) {
    state.searchReturn = snapshot(fid);
    state.screen = 'search';
    render();
    const input = $('#search-input'); input.focus(); input.setSelectionRange(input.value.length, input.value.length);
  }
  function addRecent(query, scope) {
    const key = JSON.stringify([query.trim().toLowerCase(), scope]);
    recents = [{ query, scope }, ...recents.filter(r => JSON.stringify([r.query.trim().toLowerCase(), r.scope]) !== key)].slice(0, 8);
    store.set('recents-v3', recents);
  }
  function setCategory(id) {
    if (state.category === id) return;
    state.category = id;
    // Vehicle filters only belong to Cars & trucks; seller type and price carry over.
    if (!isCars(id)) state.extras.applied = { ...noExtras(), seller: state.extras.applied.seller };
  }
  function submitSearch(q, scope) {
    const query = q.trim().replace(/\s+/g, ' ');
    if (!query) return false;
    state.searchReturn = null;
    const kw = D.categoryKeywords[query.toLowerCase()];
    if (kw) { addRecent('Cars', { category: 'all' }); setCategory(kw); state.query = ''; showList('search-field'); return true; }
    if (scope) {
      if (scope.category) setCategory(scope.category);
      if (scope.location) state.location = scope.location;
      if (scope.radius) state.radius = scope.radius;
      if (scope.price) state.price.applied = { min: scope.price.min ?? null, max: scope.price.max ?? null };
    }
    state.query = query;
    addRecent(query, { category: state.category, ...(state.radius !== 25 ? { radius: state.radius } : {}), ...(state.location !== 'mpls' ? { location: state.location } : {}), ...(hasPrice() ? { price: { ...state.price.applied } } : {}) });
    showList('search-field');
    return true;
  }

  // ---------- Actions ----------

  const actions = {
    noop() {},
    'tab-search'() { const list = $('[data-scroll="list"]'); if (list) list.scrollTo({ top: 0, behavior: 'smooth' }); },
    'sheet-close'() { closeOverlay(); },
    grabber() {
      if (state.screen === 'home') { setHomeSheet(state.homeSheet === 'expanded' ? 'rest' : 'expanded'); return; }
      actions[state.view === 'map' ? 'map-collapse' : 'map-expand']();
    },

    // Category, location, proximity (applied on selection; Close discards)
    'open-category'(el) { openOverlay('category', el); },
    'category-pick'(el) {
      const id = el.dataset.id;
      if (id === state.category) { closeOverlay(); return; }
      setCategory(id);
      dismissOverlay();
      showList('pill-category');
      announce(catLabel(id));
    },
    'open-location'(el) { openOverlay('location', el); },
    'location-pick'(el) { state.draftLocation = el.dataset.id; syncLocationUi(el.dataset.id); },
    'location-apply'() {
      if (state.draftLocation === state.location) { closeOverlay(); return; }
      state.location = state.draftLocation; dismissOverlay(); rerun('pill-location', { scrollTo: null });
    },
    'open-radius'(el) { openOverlay('radius', el); },
    'radius-pick'(el) { state.draftRadius = +el.dataset.id; syncRadiusUi(); },
    'radius-apply'() {
      if (state.draftRadius === state.radius) { closeOverlay(); return; }
      state.radius = state.draftRadius; dismissOverlay(); rerun('pill-radius', { scrollTo: null });
    },

    // Sort
    'open-sort'(el) { openOverlay('sort', el); },
    'sort-pick'(el) { state.sort = el.dataset.id; dismissOverlay(); render({ resetScroll: true }); focusFid('sort-btn'); announce(`Sorted by ${D.sorts.find(s => s.id === state.sort).label}`); },

    // Search
    'open-search'(el) { openSearch(el.dataset.fid || 'search-field'); },
    'search-cancel'() { const snap = state.searchReturn; state.searchReturn = null; restore(snap); },
    'search-clear'() { const i = $('#search-input'); i.value = ''; syncEntryField(); i.focus(); },
    'search-recent'(el) {
      const r = recents[+el.dataset.index];
      if (r.query) submitSearch(r.query, r.scope);
      else { state.searchReturn = null; state.query = ''; setCategory((r.scope && r.scope.category) || 'cars-trucks'); showList('search-field'); }
    },
    'recents-clear'() { recents = []; store.set('recents-v3', recents); const v = $('#search-input').value; render(); const i = $('#search-input'); i.value = v; syncEntryField(); i.focus(); },
    // Clearing the query keeps category, location, proximity and filters.
    'results-clear'() { state.query = ''; showList('search-field'); },

    // Price
    'open-price'(el) { openOverlay('price', el); },
    'price-clear'() {
      state.price.draft = noPrice();   // draft only; applied stays until Apply
      overlayEl.querySelectorAll('[data-num^="price."]').forEach(i => { i.value = ''; i.closest('.money').classList.remove('has-value'); });
      syncPriceUi();
      $('#price-max').focus();
    },
    'price-apply'() {
      const draft = { ...state.price.draft };
      if (priceError(draft)) return;
      if (JSON.stringify(draft) === JSON.stringify(state.price.applied)) { closeOverlay(); return; }
      applyPrice(draft);
    },
    'request-retry'() { request({ retry: true }); const h = $('#net-title'); if (h) h.focus({ preventScroll: true }); },
    // Price × removes only the price constraint.
    'price-remove'() { state.price.applied = noPrice(); state.price.draft = noPrice(); rerun('pill-price', { scrollTo: null }); },

    // Filters sheet
    'open-filters'(el) { openOverlay('filters', el); },
    'filters-clear'() {
      // Resets this sheet's draft (price, seller and vehicle details); location, category and query stay.
      // Nothing is applied until Apply.
      state.extras.draft = noExtras(); state.price.draft = noPrice();
      renderOverlay();
      focusFirst(overlayEl.querySelector('form'));
      announce('Filters cleared. Apply to show the results.');
    },
    'filters-apply'() {
      const x = state.extras.draft, price = { ...state.price.draft };
      if (priceError(price) || (isCars() && yearError(x))) return;
      state.extras.applied = { ...x };
      // A price change goes through the same (simulated) network apply as the price sheet.
      if (JSON.stringify(price) !== JSON.stringify(state.price.applied)) { applyPrice(price, 'filters-btn'); return; }
      dismissOverlay();
      rerun('filters-btn');
    },
    'extras-clear-applied'() {
      state.extras.applied = noExtras(); state.extras.draft = noExtras();
      state.price.applied = noPrice(); state.price.draft = noPrice();
      rerun('filters-btn', { scrollTo: null });
    },

    // Details
    'open-details'(el) {
      state.returnTo = snapshot(el.dataset.fid);
      const ids = shown().map(l => l.id);
      const ss = matchedSaved();
      state.details = { id: el.dataset.id, ids: ids.includes(el.dataset.id) ? ids : [el.dataset.id], fromSaved: ss ? ss.id : null };
      state.screen = 'details';
      render();
      focusFid('details-close');
    },
    'details-step'(el) {
      const d = state.details, i = d.ids.indexOf(d.id) + (+el.dataset.dir);
      if (i < 0 || i >= d.ids.length) return;
      d.id = d.ids[i];
      if (state.returnTo) { state.returnTo.fid = 'card-' + d.id; if (state.returnTo.selectedListingId) { state.returnTo.selectedListingId = d.id; state.returnTo.fid = 'preview-open'; } }
      render();
      focusFid(+el.dataset.dir < 0 ? (i === 0 ? 'details-next' : 'details-prev') : (i === d.ids.length - 1 ? 'details-prev' : 'details-next'));
      announce(`Listing ${i + 1} of ${d.ids.length}: ${byId[d.id].title}`);
    },
    'details-close'() {
      const id = state.details.id;
      if (sim.removedId === id && !state.removed.includes(id)) state.removed.push(id);
      const snap = state.returnTo; state.returnTo = null; state.details = null;
      if (snap.selectedListingId === id && state.removed.includes(id)) { snap.selectedListingId = null; snap.fid = null; }
      restore(snap);
    },
    'toggle-save'() {
      const id = state.details.id;
      saved = saved.includes(id) ? saved.filter(x => x !== id) : [...saved, id];
      store.set('saved-listings', saved);
      const on = saved.includes(id);
      if (!on && priceAlerts.includes(id)) { priceAlerts = priceAlerts.filter(x => x !== id); persistAlerts(); }
      rerenderDetails('save-star');
      announce(on ? 'Saved to Favorites. Price-drop alerts are available for this listing.' : 'Removed from Favorites');
    },
    'price-alert-toggle'() {
      const id = state.details.id, on = !priceAlerts.includes(id);
      priceAlerts = on ? [...priceAlerts, id] : priceAlerts.filter(x => x !== id);
      persistAlerts(); rerenderDetails('price-alert');
      announce(on ? 'Price-drop alerts on' : 'Price-drop alerts off');
    },
    'stop-updates'() {
      const id = state.details.id;
      priceAlerts = priceAlerts.filter(x => x !== id); persistAlerts(); rerenderDetails('price-alert');
      announce('Updates stopped for this listing');
    },

    // Saved searches (exploration)
    'open-save'(el) { openOverlay('save', el, { alerts: 'off' }); },
    'save-search-confirm'() {
      const crit = criteria(), key = critKey(crit), now = Date.now();
      const existing = savedSearches.find(x => critKey(x.crit) === key);
      const ss = existing || { id: 'S' + now.toString(36), crit, savedAt: now, lastViewedAt: now };
      ss.alerts = state.overlay.alerts;
      savedSearches = [ss, ...savedSearches.filter(x => x !== ss)];
      persistSaved();
      state.savedView = { id: ss.id, newIds: [], since: now };
      dismissOverlay();
      showSavedToast(ss.id);
      focusFid('save-btn');
      announce(`Search saved. ${searchLabel(ss.crit)}. Alerts: ${alertsLabel(ss.alerts)}.`);
    },
    'open-manage'(el) {
      const ss = matchedSaved() || savedSearches[0];
      if (!ss) return;
      openOverlay('manage', el, { id: ss.id, alerts: ss.alerts });
    },
    'manage-done'() {
      const ss = savedSearches.find(x => x.id === state.overlay.id);
      const changed = ss.alerts !== state.overlay.alerts;
      ss.alerts = state.overlay.alerts; persistSaved();
      closeOverlay(); refresh();
      if (changed) announce(ss.alerts === 'off' ? 'Alerts paused. Your search stays saved.' : `Alerts: ${alertsLabel(ss.alerts)}`);
    },
    'manage-remove'() {
      const id = state.overlay.id;
      savedSearches = savedSearches.filter(x => x.id !== id); persistSaved();
      if (state.savedView && state.savedView.id === id) state.savedView = null;
      if (state.savedToast === id) state.savedToast = null;
      dismissOverlay(); refresh();
      if (!focusFid('save-btn')) focusFirst(screenEl);
      announce('Saved search removed');
    },
    'continue-search'() { openSavedSearch(savedSearches[0]); },
    'notif-open'() { openNotification(); },
    'notif-dismiss'() { hideNotification(); },

    // Map
    'map-expand'() { if (!expandMapAvailable()) return; state.view = 'map'; render(); focusFid('map-collapse'); announce('Map in view'); },
    'map-collapse'() { state.view = 'list'; state.selectedListingId = null; state.expandedCluster = null; state.pan = { x: 0, y: 0 }; render(); focusFid('map-toggle'); announce('List in view'); },
    'map-zoom-in'() { if (lmap) { mapView.userMoved = true; lmap.zoomIn(1); } },
    'map-zoom-out'() { if (lmap) { mapView.userMoved = true; lmap.zoomOut(1); } },
    'map-reset'() { fitSearchArea({ animate: true }); announce(`Map reset to the ${state.radius}-mile search area around ${loc().label}`); },
    'map-retry'() { state.mapIssue = null; mapView.tileErrors = 0; refresh(); if (tiles) tiles.redraw(); },
    'marker-select'(el) {
      state.selectedListingId = el.dataset.id; render(); keepSelectionVisible(); focusFid('preview-open');
      const l = byId[el.dataset.id]; announce(`${l.title}, ${money(l.price)}, ${l.area}`);
    },
    'cluster-open'(el) { state.expandedCluster = el.dataset.key; render(); focusFid('marker-' + el.dataset.key.split('-')[0]); },
    'preview-dismiss'() { const id = state.selectedListingId; state.selectedListingId = null; render(); if (!focusFid('marker-' + id)) focusFirst(screenEl); },
    'map-bg'(el, e) {
      if (e && e.target.closest('.marker, .cluster')) return;
      if (!state.selectedListingId && !state.expandedCluster) return;
      state.selectedListingId = null; state.expandedCluster = null; render();
    }
  };

  function syncEntryField() {
    const input = $('#search-input'); if (!input) return;
    const has = input.value.length > 0;
    $('#entry-field').classList.toggle('has-clear', has);
    $('[data-action="search-clear"]').hidden = !has;
  }
  function syncPriceUi() {
    const p = state.price.draft, err = priceError(p);
    overlayEl.querySelector('[data-action="price-clear"]').disabled = !hasPrice(p);
    overlayEl.querySelector('[data-apply]').disabled = !!err;
    const e = $('#price-error'); e.hidden = !err; e.textContent = err;
  }
  function syncFiltersUi() {
    const x = state.extras.draft, cars = isCars();
    overlayEl.querySelectorAll('.seg').forEach(s => s.classList.toggle('is-on', s.querySelector('input').checked));
    const pErr = priceError(state.price.draft), yErr = cars ? yearError(x) : '';
    const pe = $('#price-error'); pe.hidden = !pErr; pe.textContent = pErr;
    const e = $('#extras-error'); if (e) { e.hidden = !yErr; e.textContent = yErr; }
    const btn = overlayEl.querySelector('[data-apply]');
    btn.disabled = !!(pErr || yErr);
    btn.textContent = filtersApplyLabel();
    overlayEl.querySelector('[data-action="filters-clear"]').disabled = draftEmpty();
    const n = $('#missing-note'), note = missingNote(); n.hidden = !note; n.textContent = note;
  }
  // Location: filter the supported list as the person types; picks only move the draft checkmark.
  function syncLocationUi(focusId) {
    const q = state.overlay.locQuery || '', list = locationMatches(q);
    $('#loc-list').innerHTML = locationRows(list);
    $('#loc-hint').textContent = locationHint(q, list);
    const changed = state.draftLocation !== state.location;
    $('[data-action="location-apply"]').textContent = changed ? `Search ${loc(state.draftLocation).label} · ${showLabel(compute({ location: state.draftLocation }).length)}` : 'Done';
    if (focusId) { const b = overlayEl.querySelector(`[data-action="location-pick"][data-id="${focusId}"]`); if (b) b.focus(); announce(`${loc(focusId).label} selected. Apply to search there.`); }
  }
  // Proximity: the checkmark, the preview circle and dots, the caption and the Apply label follow the draft radius.
  function syncRadiusUi() {
    const r = state.draftRadius, m = radiusPreviewModel(r);
    overlayEl.querySelectorAll('[data-action="radius-pick"]').forEach(b => {
      const on = +b.dataset.id === r;
      b.classList.toggle('is-selected', on); b.setAttribute('aria-current', String(on));
      const c = b.querySelector('.ic-check'); if (on && !c) b.insertAdjacentHTML('beforeend', icon('checkmark', 'ic-check')); if (!on && c) c.remove();
    });
    $('.rp-world').style.transform = `scale(${m.s.toFixed(4)}) translate(${(-m.cx).toFixed(1)}px,${(-m.cy).toFixed(1)}px)`;
    $('.rp-circle').setAttribute('r', m.r.toFixed(1));
    $('.rp-centre').setAttribute('r', (6 / m.s).toFixed(1));
    overlayEl.querySelectorAll('.rp-dot').forEach((d, i) => { d.setAttribute('r', (4 / m.s).toFixed(1)); d.classList.toggle('is-on', m.dots[i].on); });
    $('#radius-caption').textContent = radiusCaption(r);
    $('[data-action="radius-apply"]').textContent = r !== state.radius ? `Use ${r} miles · ${showLabel(compute({ radius: r }).length)}` : 'Done';
  }

  // ---------- Events ----------

  appEl.addEventListener('click', e => {
    const el = e.target.closest('[data-action]');
    if (!el || !appEl.contains(el)) { const m = e.target.closest('.money:not(.select-surface)'); if (m) m.querySelector('input').focus(); return; }
    if (el.getAttribute('aria-disabled') === 'true' || el.disabled) { e.preventDefault(); return; }
    const fn = actions[el.dataset.action];
    if (fn) { e.preventDefault(); fn(el, e); }
  });
  appEl.addEventListener('submit', e => {
    e.preventDefault();
    const f = e.target.dataset.form;
    if (f === 'search') { const i = $('#search-input'); if (!submitSearch(i.value)) i.focus(); }
    else if (f === 'price') actions['price-apply']();
    else if (f === 'filters') actions['filters-apply']();
    else if (f === 'save-search') actions['save-search-confirm']();
    else if (f === 'manage-search') actions['manage-done']();
    else if (f === 'location') {
      const list = locationMatches(state.overlay.locQuery);
      if (list.length === 1) { state.draftLocation = list[0].id; syncLocationUi(list[0].id); }
      else $('#loc-input').focus();
    }
  });
  appEl.addEventListener('input', e => {
    const t = e.target;
    if (t.id === 'search-input') { syncEntryField(); return; }
    if (t.id === 'loc-input') {
      state.overlay.locQuery = t.value;
      t.closest('.money').classList.toggle('has-value', !!t.value);
      // A complete supported ZIP code selects that location (still a draft until Apply).
      const zip = D.locations.find(l => l.zip === t.value.trim());
      if (zip) state.draftLocation = zip.id;
      syncLocationUi();
      return;
    }
    if (t.dataset.num) {
      const [group, key] = t.dataset.num.split('.');
      const isYear = group === 'extras';
      const digits = t.value.replace(/\D/g, '').replace(/^0+(?=\d)/, '').slice(0, isYear ? 4 : 7);
      const val = digits ? parseInt(digits, 10) : null;
      const target = group === 'price' ? state.price.draft : state.extras.draft;
      // A year counts once all four digits are typed; until then the field is treated as empty.
      target[key] = isYear && val != null && digits.length < 4 ? null : val;
      t.value = val == null ? '' : (isYear ? digits : val.toLocaleString('en-US'));
      t.closest('.money').classList.toggle('has-value', val != null);
      if (state.overlay && state.overlay.type === 'filters') syncFiltersUi(); else syncPriceUi();
    }
  });
  appEl.addEventListener('change', e => {
    const t = e.target;
    if (state.overlay && ['save', 'manage'].includes(state.overlay.type) && t.name === 'alerts') {
      state.overlay.alerts = t.value;
      overlayEl.querySelectorAll('.seg').forEach(x => x.classList.toggle('is-on', x.querySelector('input').checked));
      return;
    }
    if (!state.overlay || state.overlay.type !== 'filters') return;
    const x = state.extras.draft;
    if (t.type === 'radio') { x[t.name] = t.value === '' ? null : (t.name === 'mileage' ? +t.value : t.value); syncFiltersUi(); }
    if (t.dataset.select === 'make') {
      x.make = t.value || null;
      // Changing make resets a model that doesn't belong to it.
      if (x.model && (!x.make || !D.makeModels[x.make].includes(x.model))) x.model = null;
      renderOverlay(); $('#extras-make').focus();
      announce(x.make ? `Make ${x.make}. Model ${x.model || 'any'}` : 'Any make');
    }
    if (t.dataset.select === 'model') { x.model = t.value || null; syncFiltersUi(); }
  });
  document.addEventListener('keydown', e => {
    const o = state.overlay;
    if (isMenu(o)) {
      const items = [...overlayEl.querySelectorAll('.menu-item')], i = items.indexOf(document.activeElement);
      const next = { ArrowDown: (i + 1) % items.length, ArrowUp: (i - 1 + items.length) % items.length, Home: 0, End: items.length - 1 }[e.key];
      if (next != null) { items[next].focus(); e.preventDefault(); return; }
      if (e.key === 'Tab') { e.preventDefault(); closeOverlay(); return; }
    }
    const g = document.activeElement && document.activeElement.classList.contains('grabber-btn');
    if (g && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      if (state.screen === 'home') { setHomeSheet(e.key === 'ArrowUp' ? 'expanded' : 'rest'); focusFid('grabber'); return; }
      if (e.key === 'ArrowUp' && state.view === 'map') actions['map-collapse']();
      if (e.key === 'ArrowDown' && state.view === 'list') actions['map-expand']();
      focusFid('grabber');
      return;
    }
    // Keep Tab inside an open sheet (the results behind it are inert).
    if (e.key === 'Tab' && o) {
      const dlg = overlayEl.querySelector('[role="dialog"]');
      const f = dlg ? [...dlg.querySelectorAll('button:not([tabindex="-1"]):not([disabled]), input:not([disabled]), select:not([disabled])')].filter(el => el.offsetParent !== null && el.getAttribute('aria-disabled') !== 'true') : [];
      if (f.length) {
        const i = f.indexOf(document.activeElement);
        if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && (i === -1 || i === f.length - 1)) { e.preventDefault(); f[0].focus(); }
      }
    }
    if (e.key !== 'Escape') return;
    if (notif) { e.preventDefault(); hideNotification(); return; }
    if (o) { e.preventDefault(); closeOverlay(); }
    else if (state.screen === 'search') { e.preventDefault(); actions['search-cancel'](); }
    else if (state.screen === 'details') { e.preventDefault(); actions['details-close'](); }
    else if (state.selectedListingId) { e.preventDefault(); actions['preview-dismiss'](); }
    else if (state.expandedCluster) { e.preventDefault(); actions['map-bg'](); }
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
    if (isDiscovery() && !drag) applyFrame({ animate: false });
    if (lmap) lmap.invalidateSize({ pan: false });
  }
  if (window.visualViewport) { window.visualViewport.addEventListener('resize', fitViewport); window.visualViewport.addEventListener('scroll', fitViewport); }
  window.addEventListener('resize', fitViewport);
  mobileMQ.addEventListener('change', fitViewport);
  window.addEventListener('scroll', () => { if (mobileMQ.matches && window.scrollY) window.scrollTo(0, 0); });
  appEl.addEventListener('scroll', () => { appEl.scrollTop = 0; appEl.scrollLeft = 0; });
  device.addEventListener('scroll', () => { device.scrollTop = 0; device.scrollLeft = 0; });

  // ---------- Reviewer controls (outside the app) ----------

  // Scenario buttons: choosing one (again) re-arms it, so each scenario can be demonstrated repeatedly.
  const scenarioBtns = [...document.querySelectorAll('[data-sim-network]')];
  function syncSimControls() {
    scenarioBtns.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.simNetwork === sim.network)));
    const note = document.getElementById('sim-state');
    if (note) note.textContent = sim.network === 'fail' ? (sim.failArmed ? 'The next search will fail.' : 'Failure used: Retry and later searches work. Choose it again to repeat.')
      : sim.network === 'slow' ? 'Every search takes 6 seconds.' : '';
  }
  scenarioBtns.forEach(b => b.addEventListener('click', () => { sim.network = b.dataset.simNetwork; sim.failArmed = sim.network === 'fail'; syncSimControls(); }));
  const remChk = document.getElementById('sim-removed');
  if (remChk) { remChk.checked = sim.removedId === 'L01'; remChk.addEventListener('change', () => { sim.removedId = remChk.checked ? 'L01' : null; }); }
  const reset = document.getElementById('sim-reset');
  if (reset) reset.addEventListener('click', () => { cancelRequests(); state = initialState(); sim.failArmed = sim.network === 'fail'; syncSimControls(); render({ resetScroll: true }); request({ fresh: true }); });
  syncSimControls();

  document.querySelectorAll('[data-demo]').forEach(b => b.addEventListener('click', () => demoEvent(b.dataset.demo)));
  if (['new-match', 'price-drop'].includes(params.get('demo'))) setTimeout(() => demoEvent(params.get('demo')), 1200);

  window.CL_PROTO = {
    demo: demoEvent, get saved() { return JSON.parse(JSON.stringify({ savedSearches, priceAlerts, demo })); },
    get state() { return JSON.parse(JSON.stringify(state)); }, ids: () => shown().map(l => l.id), sim, milesFrom: id => milesFrom(byId[id]),
    // Test hook: read the live map (one instance) without changing it.
    map: () => lmap && { center: lmap.getCenter(), zoom: lmap.getZoom(), circle: { center: circleLayer.getLatLng(), radius: circleLayer.getRadius() }, containers: document.querySelectorAll('.leaflet-container').length, id: lmap._leaflet_id, userMoved: mapView.userMoved, touchZoom: lmap.touchZoom.enabled(), dragging: lmap.dragging.enabled(), issue: state.mapIssue,
      metresPerPx: (() => { const c = lmap.getCenter(), p = lmap.latLngToContainerPoint(c); return lmap.distance(c, lmap.containerPointToLatLng([p.x + 100, p.y])) / 100; })(),
      point: id => { const pt = lmap.latLngToContainerPoint(id ? byId[id].latLng : circleLayer.getLatLng()); return { x: pt.x, y: pt.y }; } },
    latLng: id => byId[id] ? byId[id].latLng : loc(id).latLng,
    // Test hook: same effect as pressing a scenario button.
    setNetwork(n) { sim.network = n; sim.failArmed = n === 'fail'; syncSimControls(); }
  };

  initMap();
  fitViewport();
  render({ resetScroll: true });
  request({ fresh: true });
})();
