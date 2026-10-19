/* Craigslist iOS redesign — browser prototype (prototype update handoff).
   One store for all screens. Discovery screens (Home, browsing, results) share one map and one results sheet
   with two positions (list, map). Sheets edit drafts until Apply. The list count, cards and map markers always
   come from the same filtered set. */
(function () {
  'use strict';

  const D = window.CL_DATA;
  const byId = Object.fromEntries(D.listings.map(l => [l.id, l]));
  const IMG = 'assets/icons/';
  const PX = 0.5104;                       // pt per metro-map image px
  const SEARCH_LABEL = 'Search listings';  // accessible name, separate from the placeholder
  const UNAVAILABLE = 'not available in this prototype';

  const appEl = document.getElementById('app');
  const screenEl = document.getElementById('screen');
  const overlayEl = document.getElementById('overlay');
  const liveEl = document.getElementById('live');
  const device = document.getElementById('device');

  // ---------- Reviewer simulation (set outside the app: desktop notes or URL ?network=slow|fail&removed=L01) ----------

  const params = new URLSearchParams(location.search);
  const sim = {
    network: ['slow', 'fail'].includes(params.get('network')) ? params.get('network') : 'normal',
    removedId: byId[params.get('removed')] ? params.get('removed') : null,
    failedOnce: false
  };
  const delay = kind => ({ normal: { load: 700, apply: 600 }, slow: { load: 2600, apply: 3000 }, fail: { load: 700, apply: 1200 } }[sim.network][kind]);

  // ---------- Local persistence ----------

  const store = {
    get(key, fallback) { try { const v = localStorage.getItem('cl-proto-' + key); return v ? JSON.parse(v) : fallback; } catch (_) { return fallback; } },
    set(key, val) { try { localStorage.setItem('cl-proto-' + key, JSON.stringify(val)); } catch (_) { /* private mode */ } }
  };
  let saved = store.get('saved-listings', []).filter(id => byId[id]);
  let recents = store.get('recents-v2', null) || [{ query: 'Cars', scope: { category: 'all' } }, ...D.recentSeed];

  // ---------- State ----------

  const noPrice = () => ({ min: null, max: null });
  function initialState() {
    return {
      screen: 'home',            // home | browse | results | search | details
      query: '',
      category: 'all',           // all | cars-trucks
      price: { applied: noPrice(), draft: noPrice() },
      seller: { applied: null, draft: null },     // null = All · Owner · Dealer
      mileage: { applied: null, draft: null },    // null = Any · 100000 = under 100,000 mi
      view: 'list',              // list | map
      selectedListingId: null,
      expandedCluster: null,
      pan: { x: 0, y: 0 },
      mapScale: 1,
      details: null,             // { id }
      returnTo: null,            // { screen, view, listScrollY, filterRowScrollX, selectedListingId, ... }
      searchReturn: null,
      overlay: null,             // { type, focusReturn }
      loading: true,             // first load: skeleton cards, never an empty state
      pending: null,             // { price, status: 'applying' | 'failed' } while a new price is applied
      removed: []                // listings found to be removed, hidden from results
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
  const catLabel = id => id === 'all' ? 'All categories' : 'Cars & trucks';
  const scopeLine = () => `${catLabel(state.category)} · ${D.location.label} · ${D.radius} miles`;

  const hasPrice = (p = state.price.applied) => p.min != null || p.max != null;
  function priceLabel(p = state.price.applied) {
    if (p.min != null && p.max != null) return `${money(p.min)}–${money(p.max)}`;
    if (p.max != null) return `Up to ${money(p.max)}`;
    if (p.min != null) return `From ${money(p.min)}`;
    return 'Any price';
  }
  const vehicleFiltered = () => state.seller.applied != null || state.mileage.applied != null;
  // n = 1 for a set price + 1 for seller ≠ All + 1 for mileage ≠ Any (location, radius, category never count).
  const filterCount = () => (hasPrice() ? 1 : 0) + (state.seller.applied ? 1 : 0) + (state.mileage.applied ? 1 : 0);
  function alsoFiltered() {
    const parts = [];
    if (state.seller.applied) parts.push(`${state.seller.applied} only`);
    if (state.mileage.applied) parts.push('under 100,000 mi');
    return parts.length ? `Also filtered: ${parts.join(' · ')}` : '';
  }

  function words(s) { return s.toLowerCase().replace(/volkswagen/g, 'vw').replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean); }

  // The one filtered set behind every count, card and marker.
  function compute({ price = state.price.applied, seller = state.seller.applied, mileage = state.mileage.applied } = {}) {
    let base;
    if (!state.query && state.category === 'cars-trucks') base = D.browseIds.map(id => byId[id]);
    else {
      const q = words(state.query);
      base = D.listings.filter(l => state.category === 'all' || l.category === state.category)
        .filter(l => { const t = words(l.title); return q.every(w => t.some(tw => tw.startsWith(w))); });
    }
    return base
      .filter(l => !state.removed.includes(l.id))
      .filter(l => (price.min == null || l.price >= price.min) && (price.max == null || l.price <= price.max))
      .filter(l => !seller || l.seller === seller)
      .filter(l => !mileage || (l.miles != null && l.miles < mileage))
      .sort((a, b) => a.minutes - b.minutes || a.id.localeCompare(b.id));
  }

  const listScreen = () => state.query ? 'results' : (state.category === 'all' ? 'home' : 'browse');
  const showsMarkers = () => !!state.query || state.category !== 'all';   // initial Home: circle only
  function announce(msg) { liveEl.textContent = ''; setTimeout(() => { liveEl.textContent = msg; }, 30); }

  // Controls the spec keeps unavailable: visible, inert, announced.
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

  // Map world: supplied metro image at the shared scale, centred on 55401. Circle, markers and the centre mark live
  // inside the world, so they stay anchored to the map when it is re-framed, zoomed to fit, panned or resized.
  function mapBg(opts = {}) {
    const c = D.location.px;
    const r = D.radius * D.PX_PER_MILE * PX;
    const cx = c[0] * PX, cy = c[1] * PX;
    return `<div class="map-bg ${opts.home ? 'is-home' : ''}" data-action="map-bg">
      <div class="map-world" style="left:calc(50% - ${cx.toFixed(2)}px);top:calc(var(--top) - 59px - 208.65px);transform-origin:${cx.toFixed(2)}px ${cy.toFixed(2)}px;--pan-x:${state.pan.x}px;--pan-y:${state.pan.y}px;--s:${state.mapScale};--inv:${(1 / state.mapScale).toFixed(4)}">
        <img class="map-img" src="assets/map/metro-map.png" alt="">
        <svg class="map-circle" aria-hidden="true" width="${(2 * r).toFixed(2)}" height="${(2 * r).toFixed(2)}" viewBox="0 0 ${(2 * r).toFixed(2)} ${(2 * r).toFixed(2)}" style="left:${(cx - r).toFixed(2)}px;top:${(cy - r).toFixed(2)}px"><circle cx="${r.toFixed(2)}" cy="${r.toFixed(2)}" r="${r.toFixed(2)}"/></svg>
        ${opts.home ? '' : `<img class="map-center" src="assets/map/search-center.svg" alt="" style="left:${(cx - 9).toFixed(2)}px;top:${(cy - 9).toFixed(2)}px">`}
        <div class="markers" role="group" aria-label="Listing markers">${opts.markers || ''}</div>
      </div>
    </div>
    <div class="map-edge"></div>`;
  }

  // Filter pills. Default: white 90 %; applied: purple tint + 1 px inner purple border.
  function pillDefault(label, { tag = false, action, fid, aria }) {
    const inner = `${tag ? icon('tag', 'ic-tag') : ''}<span>${esc(label)}</span>${icon('caret-down', 'ic-caret')}`;
    return `<div class="pill"><button type="button" class="pill-edit inset-focus" data-action="${action}" data-fid="${fid}" aria-label="${esc(aria)}" aria-haspopup="dialog">${inner}</button></div>`;
  }
  // Applied "change" variant: caret, no ×. Without an action it is shown but its picker isn't built.
  function pillChange(label, { tag = false, action, fid, aria }) {
    const inner = `${tag ? icon('tag-purple', 'ic-tag') : ''}<span>${esc(label)}</span>${icon('caret-down-purple', 'ic-caret')}`;
    const btn = action
      ? `<button type="button" class="pill-edit inset-focus" data-action="${action}" data-fid="${fid}" aria-label="${esc(aria)}" aria-haspopup="dialog">${inner}</button>`
      : `<button type="button" class="pill-edit inset-focus" data-action="noop" data-fid="${fid}" aria-disabled="true" aria-label="${esc(aria)}, ${UNAVAILABLE}">${inner}</button>`;
    return `<div class="pill is-applied">${btn}</div>`;
  }
  // Applied "remove" variant (price only): label opens the sheet; separate 44 × 44 × clears the price.
  function pillRemove(label, { action, removeAction, fid, aria, removeAria }) {
    return `<div class="pill is-applied">
      <button type="button" class="pill-edit inset-focus" data-action="${action}" data-fid="${fid}" aria-label="${esc(aria)}" aria-haspopup="dialog"><span>${esc(label)}</span></button>
      <span class="pill-divider" aria-hidden="true"></span>
      <button type="button" class="pill-remove inset-focus" data-action="${removeAction}" data-fid="${fid}-remove" aria-label="${esc(removeAria)}">${icon('xmark-pill')}</button>
    </div>`;
  }

  // One horizontally scrolling row. Order: location, radius, category, price.
  function filtersRow() {
    const pills = [
      pillChange(D.location.label, { fid: 'pill-location', aria: `Location: ${D.location.label} ${D.location.zip}` }),
      pillChange(`${D.radius} miles`, { fid: 'pill-radius', aria: `Distance: within ${D.radius} miles` })
    ];
    pills.push(state.category === 'all'
      ? pillDefault('All categories', { tag: true, action: 'open-category', fid: 'pill-category', aria: 'Category: All categories. Change category' })
      : pillChange(catLabel(state.category), { tag: true, action: 'open-category', fid: 'pill-category', aria: `Category: ${catLabel(state.category)}. Change category` }));
    if (state.screen === 'results') {
      if (state.pending) {
        // While a new price applies, the row shows the previous context.
        pills.push(hasPrice() ? pillChange(priceLabel(), { fid: 'pill-price', aria: `Price: ${priceLabel()}` }) : pillDefault('Any price', { action: 'noop', fid: 'pill-price', aria: 'Price: Any price' }).replace('data-action="noop"', 'data-action="noop" aria-disabled="true"'));
      } else if (hasPrice() && vehicleFiltered()) {
        pills.push(pillChange(priceLabel(), { fid: 'pill-price', aria: `Price: ${priceLabel()}` })); // changing price here isn't built
      } else if (hasPrice()) {
        pills.push(pillRemove(priceLabel(), { action: 'open-price', removeAction: 'price-remove', fid: 'pill-price', aria: `Price: ${priceLabel()}. Edit price`, removeAria: 'Remove price filter' }));
      } else {
        pills.push(pillDefault('Any price', { action: 'open-price', fid: 'pill-price', aria: 'Price: Any price. Set price' }));
      }
    }
    return `<div class="filters" role="group" aria-label="Quick filters">${pills.join('')}</div>`;
  }

  function card(l) {
    const photo = l.photo ? `<img src="${l.photo}" alt="" loading="lazy">` : `<span class="no-photo">${icon('photo')}<span>No photo</span></span>`;
    const seller = l.seller ? `<span class="card-seller"><span>·</span><span>${l.seller}</span></span>` : '';
    const label = `${l.title}, ${money(l.price)}, ${l.detail}${l.seller ? ', ' + l.seller : ''}, ${plural(l.hours, 'hour')} ago, ${l.area}${l.photo ? '' : ', no photo'}`;
    return `<button type="button" class="card" data-action="open-details" data-id="${l.id}" data-fid="card-${l.id}" aria-label="${esc(label)}">
      <span class="card-photo">${photo}<span class="price-badge">${money(l.price)}</span></span>
      <span class="card-text">
        <span class="card-title">${esc(l.title)}</span>
        <span class="card-detail"><span>${esc(l.detail)}</span>${seller}</span>
        <span class="card-meta">${l.hours} hr ago • ${esc(l.area)}</span>
      </span>
    </button>`;
  }
  const grid = (list, attrs = '') => `<ul class="grid"${attrs}>${list.map(l => `<li>${card(l)}</li>`).join('')}</ul>`;
  const skeletonGrid = () => `<ul class="grid skeleton" aria-hidden="true">${'<li><span class="sk-photo"></span><span class="sk-line w80"></span><span class="sk-line w60"></span><span class="sk-line w70"></span></li>'.repeat(4)}</ul>`;
  const newest = () => unavailable('menu-btn', `<span>Newest</span>${icon('caret-down')}`, 'Sort: Newest');
  const spinner = () => '<span class="spinner" aria-hidden="true"></span>';

  function filtersBtn() {
    const n = filterCount();
    const label = `${icon('sliders')}<span>Filters${n ? ` (${n})` : ''}</span>`;
    // Opens from the price-filtered results only.
    if (state.screen === 'results' && hasPrice() && !state.pending) {
      return `<button type="button" class="quiet" data-action="open-filters" data-fid="filters-btn" aria-haspopup="dialog">${label}</button>`;
    }
    return unavailable('quiet', label, `Filters${n ? `, ${n} active` : ''}`, ' data-fid="filters-btn"');
  }
  const saveSearch = () => unavailable('quiet', `${icon('saved-search')}<span>Save search</span>`, 'Save search');
  const placeholder = () => state.category === 'all' ? 'Try searching ‘cars’' : 'Search cars & trucks';

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
  const expandMapAvailable = () => !vehicleFiltered() && !state.pending && !state.loading;
  function expandMapBtn() {
    const inner = `${icon('map')}<span>Expand map</span>`;
    return expandMapAvailable()
      ? `<button type="button" class="quiet map-toggle" data-action="map-expand" data-fid="map-toggle">${inner}</button>`
      : unavailable('quiet map-toggle', inner, 'Expand map', ' data-fid="map-toggle"');
  }

  // List body: first-load skeleton, applying/failed price, results, or no results.
  function listBody(list) {
    const isResults = state.screen === 'results';
    if (state.loading) {
      return `<div class="list-header status-row" role="status"><span class="status-text">${spinner()}<span class="t-sub-e">Loading listings…</span></span>${newest()}</div>${skeletonGrid()}`;
    }
    const prevLabel = `Previous results · ${priceLabel()} · ${plural(list.length, 'listing')}`;
    if (state.pending && state.pending.status === 'applying') {
      return `<div class="list-header status-row" role="status"><span class="status-text">${spinner()}<span class="t-sub-e">Applying ${esc(priceLabel(state.pending.price))}…</span></span>${newest()}</div>
        <p class="t-sub c2 prev-label" style="margin:0">${esc(prevLabel)}</p>
        ${grid(list, ' data-dim="true" inert')}`;
    }
    if (state.pending && state.pending.status === 'failed') {
      const want = priceLabel(state.pending.price);
      return `<div class="error-card" role="alert">
          <h2 class="t-headline" style="margin:0">Couldn’t apply ${esc(want)}</h2>
          <p class="t-sub c2" style="margin:0">Your search is kept. Showing previous results at ${esc(priceLabel())}. Retry applies ${esc(want)} again.</p>
          <button type="button" class="primary-btn" data-action="retry-apply" data-fid="retry-btn">Retry</button>
        </div>
        <div class="list-header"><h2 class="t-sub-e" style="margin:0" id="results-count">${esc(prevLabel)}</h2>${newest()}</div>
        ${grid(list)}`;
    }
    if (!list.length) {
      if (isResults && hasPrice()) {
        return `<div class="no-results">
          <h2 class="t-headline" style="margin:0" id="results-count">No listings match your search.</h2>
          <p class="t-sub c2" style="margin:0">Try increasing your maximum price or removing the price filter.</p>
          <button type="button" class="primary-btn" data-action="price-remove" data-fid="recover-btn">Remove price filter</button>
        </div>`;
      }
      return `<div class="no-results"><h2 class="t-headline" style="margin:0" id="results-count">No listings match your search.</h2>
        <p class="t-sub c2" style="margin:0">Check the spelling or try different words.</p></div>`;
    }
    const header = isResults
      ? `<h2 class="t-headline" style="margin:0" id="results-count">${plural(list.length, 'result')}</h2>`
      : `<h2 class="t-sub c2" style="margin:0" id="results-count">Listings within ${D.radius} miles</h2>`;
    return `<div class="list-header">${header}${newest()}</div>${grid(list)}`;
  }

  // ---------- Markers ----------

  function markerGroups(list, k = state.mapScale) {
    // Seed-based grouping in a fixed ID order; distances measured on screen.
    const groups = [];
    for (const l of list.slice().sort((a, b) => a.id.localeCompare(b.id))) {
      const p = { l, x: l.mapPx[0] * PX, y: l.mapPx[1] * PX };
      const g = groups.find(g => Math.abs(g.seed.x - p.x) * k < 56 && Math.abs(g.seed.y - p.y) * k < 40);
      if (g) g.items.push(p); else groups.push({ seed: p, items: [p] });
    }
    groups.forEach(g => {
      g.x = g.items.reduce((s, p) => s + p.x, 0) / g.items.length;
      g.y = g.items.reduce((s, p) => s + p.y, 0) / g.items.length;
      g.items.sort((a, b) => a.l.minutes - b.l.minutes);
      g.key = g.items.map(p => p.l.id).sort().join('-');
    });
    return groups;
  }
  function markerHtml(l, x, y) {
    const sel = state.selectedListingId === l.id;
    return `<button type="button" class="marker ${sel ? 'is-selected' : ''}" style="left:${x.toFixed(2)}px;top:${y.toFixed(2)}px" data-action="marker-select" data-id="${l.id}" data-fid="marker-${l.id}"
      aria-pressed="${sel}" aria-label="${esc(l.title)}, ${money(l.price)}, ${esc(l.area)}, approximate location">
      <span class="marker-capsule">${money(l.price)}</span>${sel ? `<span class="marker-pointer"><img src="assets/map/marker-pointer.svg" alt=""></span>` : ''}</button>`;
  }
  function markers(list) {
    if (!showsMarkers() || state.loading) return '';
    return markerGroups(list).map(g => {
      if (g.items.length === 1) return markerHtml(g.items[0].l, g.x, g.y);
      // A tapped cluster (or one holding the selection) spreads into its price markers.
      if (state.expandedCluster === g.key || g.items.some(p => p.l.id === state.selectedListingId)) {
        return g.items.map((p, i) => markerHtml(p.l, g.x, g.y + (i - (g.items.length - 1) / 2) * 46)).join('');
      }
      return `<button type="button" class="cluster" style="left:${g.x.toFixed(2)}px;top:${g.y.toFixed(2)}px" data-action="cluster-open" data-key="${g.key}" data-fid="cluster-${g.key}"
        aria-label="${g.items.length} listings close together. Show them"><span class="cluster-count t-sub-e">${g.items.length}</span><span class="t-sub-e">listings</span></button>`;
    }).join('');
  }
  function markerPoint(id, list) {
    const g = markerGroups(list).find(g => g.items.some(p => p.l.id === id));
    if (!g) return null;
    if (g.items.length === 1) return { x: g.x, y: g.y };
    const i = g.items.findIndex(p => p.l.id === id);
    return { x: g.x, y: g.y + (i - (g.items.length - 1) / 2) * 46 };
  }

  // ---------- Discovery screen ----------

  function screenDiscovery() {
    const list = compute();
    const home = state.screen === 'home';
    const results = state.screen === 'results';
    const sel = state.view === 'map' && state.selectedListingId && list.find(l => l.id === state.selectedListingId);
    const controls = home
      ? `<div class="sheet-controls is-home" style="align-items:stretch">
          <div class="handle-space"><div class="grabber" aria-hidden="true"></div></div>
          ${searchFieldIdle()}
          <div class="sheet-actions">${filtersBtn()}${unavailable('quiet', `${icon('saved-search')}<span>Saved searches</span>`, 'Saved searches')}</div>
        </div>`
      : `<div class="sheet-controls">
          <div class="sheet-header" data-drag>
            ${results ? `<p class="t-sub c2 header-scope" style="margin:0">${esc(scopeLine())}</p>` : `<h1 class="t-headline" id="browse-title" style="margin:0">Cars &amp; trucks</h1>`}
            ${expandMapBtn()}
          </div>
          ${results ? searchFieldFilled() : searchFieldIdle()}
          <div class="sheet-actions">${filtersBtn()}${saveSearch()}</div>
          ${results && vehicleFiltered() && !state.pending ? `<p class="also-filtered" style="margin:0">${esc(alsoFiltered())}</p>` : ''}
        </div>`;
    const summary = state.query ? `${plural(list.length, 'result')} · ${state.query}` : `${plural(list.length, 'listing')} · ${catLabel(state.category)}`;
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
      <section class="sheet dsheet surface-sheet" id="dsheet" aria-label="${home ? 'Listings near Minneapolis' : 'Results'}">
        ${home ? '' : `<button type="button" class="grabber-btn" data-action="grabber" data-drag data-fid="grabber" aria-label="${grabberLabel()}"></button>`}
        <div class="sheet-compact" data-drag>
          <h2 class="t-sub-e" style="margin:0" id="summary">${esc(summary)}</h2>
          <button type="button" class="quiet map-toggle" data-action="map-collapse" data-fid="map-collapse">${icon('chevron-up')}<span>Collapse map</span></button>
        </div>
        <div class="sheet-full">
          ${controls}
          <div class="list-scroll" data-scroll="list" ${state.loading || (state.pending && state.pending.status === 'applying') ? 'aria-busy="true"' : ''}>${listBody(list)}</div>
        </div>
      </section>
      ${preview}
      <div class="scroll-edge"></div>
      ${filtersRow()}
      <p class="map-label is-map-label">Approximate listing locations · ${D.radius}-mile search area</p>
      ${tabbar()}`;
  }

  // ---------- Sheet positions: list (147) and map (sheet 192 tall); Home fixed at 448 ----------

  function insets() {
    const probe = document.getElementById('inset-probe'); // top: var(--top), height: var(--bottom)
    return { top: probe.offsetTop, bottom: probe.offsetHeight, h: appEl.clientHeight };
  }
  function sheetTop(view = state.view) {
    const { top, bottom, h } = insets();
    if (state.screen === 'home') return Math.min(top + 389, h - 420);   // 448 on 932
    return view === 'map' ? h - (158 + bottom) : top + 88;               // 740 / 147 on 932
  }
  const grabberLabel = () => state.view === 'map' ? 'Results sheet, map in view. Activate to show the list.' : 'Results sheet, list in view. Activate to show the map.';

  // Map framing. Home fits the whole 25-mile circle above its sheet (zooming out, never below 60 %); the list and
  // map views use the handoff scale (S03 and M1 framing) unless the circle wouldn't fit.
  function mapFrame() {
    const { top } = insets();
    const r = D.radius * D.PX_PER_MILE * PX;
    if (state.screen === 'home') {
      const rt = top + 52, rb = sheetTop() - 8;
      return { s: +Math.min(1, Math.max(0.6, (rb - rt - 16) / (2 * r))).toFixed(4), cy: Math.round((rt + rb) / 2) };
    }
    if (state.view === 'list') return { s: 1, cy: top + 190.67 };
    const rt = top + 52, rb = sheetTop('map') - 8;
    const s = +Math.min(1, Math.max(0.6, (rb - rt - 16) / (2 * r))).toFixed(4);
    return { s, cy: s === 1 ? top + 320.67 : Math.round((rt + rb) / 2) };
  }
  function applyFrame({ animate = true } = {}) {
    const sheet = $('#dsheet'), w = $('.map-world');
    if (!sheet || !w) return;
    sheet.classList.toggle('no-anim', !animate);
    w.classList.toggle('no-anim', !animate);
    sheet.style.top = sheetTop() + 'px';
    sheet.classList.toggle('is-compact', state.view === 'map' && state.screen !== 'home');
    appEl.dataset.view = state.screen === 'home' ? 'home' : state.view;
    const g = $('[data-fid="grabber"]'); if (g) g.setAttribute('aria-label', grabberLabel());
    const f = mapFrame();
    w.style.top = (f.cy - D.location.px[1] * PX).toFixed(2) + 'px';
    w.style.setProperty('--s', f.s);
    w.style.setProperty('--inv', (1 / f.s).toFixed(4));
    if (f.s !== state.mapScale) { state.mapScale = f.s; const mk = w.querySelector('.markers'); if (mk) mk.innerHTML = markers(compute()); }
    keepSelectionVisible();
  }
  function setView(view, opts) {
    state.view = view;
    if (view === 'list') { state.pan = { x: 0, y: 0 }; applyPan(); }
    applyFrame(opts);
  }
  // Keep the selected marker visible between the controls and the preview by shifting the static map.
  function keepSelectionVisible() {
    if (state.view !== 'map' || !state.selectedListingId) return;
    const pt = markerPoint(state.selectedListingId, compute());
    if (!pt) return;
    const { top, h, bottom } = insets();
    const f = mapFrame(), W = appEl.clientWidth, c = D.location.px;
    const x = W / 2 + (pt.x - c[0] * PX) * f.s, y = f.cy + (pt.y - c[1] * PX) * f.s;
    const minY = top + 44 + 48 + 52, maxY = h - (158 + bottom) - 112 - 16;  // above the floating preview
    let { x: px, y: py } = state.pan;
    if (y + py < minY || y + py > maxY) py = Math.round((minY + maxY) / 2 - y);
    if (x + px < 64 || x + px > W - 64) px = Math.round(W / 2 - x);
    if (px !== state.pan.x || py !== state.pan.y) { state.pan = { x: px, y: py }; applyPan(); }
  }
  function applyPan() {
    const w = $('.map-world'); if (!w) return;
    w.style.setProperty('--pan-x', state.pan.x + 'px');
    w.style.setProperty('--pan-y', state.pan.y + 'px');
  }

  // Drag the grabber or sheet header between the two positions; listings scroll on their own.
  let drag = null, suppressClick = false;
  const zoomFactor = () => { const r = appEl.getBoundingClientRect(); return r.height / appEl.offsetHeight || 1; };
  appEl.addEventListener('pointerdown', e => {
    const zone = e.target.closest('[data-drag]'), sheet = $('#dsheet');
    if (!zone || !sheet || !sheet.contains(zone) || state.overlay || state.screen === 'home') return;
    const ctl = e.target.closest('button, a, input');
    if (ctl && !ctl.classList.contains('grabber-btn')) return;
    drag = { id: e.pointerId, y0: e.clientY, top0: parseFloat(sheet.style.top), moved: false, zone };
  });
  appEl.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.id) return;
    const dy = (e.clientY - drag.y0) / zoomFactor();
    if (!drag.moved && Math.abs(dy) < 6) return;
    const sheet = $('#dsheet');
    if (!drag.moved) {
      if (!expandMapAvailable() && state.view === 'list') { drag = null; return; }   // map view unavailable here
      drag.moved = true; try { drag.zone.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
      sheet.classList.add('is-dragging');
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
    const top = parseFloat(sheet.style.top), lo = sheetTop('list'), hi = sheetTop('map');
    const view = top - lo > (hi - lo) / 2 ? 'map' : 'list';
    if (view === 'list') state.selectedListingId = null, state.expandedCluster = null;
    state.view = view;
    render();
    announce(view === 'map' ? 'Map in view' : 'List in view');
  }
  appEl.addEventListener('pointerup', endDrag);
  appEl.addEventListener('pointercancel', endDrag);
  appEl.addEventListener('click', e => { if (suppressClick) { e.stopPropagation(); e.preventDefault(); } }, true);

  // ---------- Search entry ----------

  function screenSearch() {
    const rows = recents.map((r, i) => {
      const sc = r.scope || {};
      const title = r.query || 'Browse cars & trucks';
      // Query first; scope only when it differs from the current one.
      let sub = '';
      if (sc.category === 'furniture') sub = `Furniture · ${D.location.label} · ${sc.radius || D.radius} miles`;
      else if (sc.price && sc.price.max != null) sub = `Up to ${money(sc.price.max)}`;
      else if (sc.category && sc.category !== state.category && r.query && sc.category !== 'all') sub = catLabel(sc.category);
      const inner = `${icon('clock')}<span class="recent-text"><span class="t-headline">${esc(title)}</span>${sub ? `<span class="t-sub c2">${esc(sub)}</span>` : ''}</span>`;
      return `<li>${r.unavailable
        ? unavailable('recent-row', inner, `Recent search: ${title}${sub ? ', ' + sub : ''}`)
        : `<button type="button" class="recent-row inset-focus" data-action="search-recent" data-index="${i}" aria-label="Recent search: ${esc(title)}${sub ? ', ' + esc(sub) : ''}">${inner}</button>`}</li>`;
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

  function screenDetails() {
    const l = byId[state.details.id];
    if (sim.removedId === l.id) {
      return `<div class="details is-removed" role="dialog" aria-modal="true" aria-labelledby="removed-title">
        <div class="modal-toolbar"><button type="button" class="glass-btn" data-action="details-close" data-fid="details-close" aria-label="Close">${icon('xmark-glass')}</button></div>
        <div class="removed">
          <h1 class="t-title3" id="removed-title" style="margin:0">This listing is no longer available.</h1>
          <p class="t-sub c2" style="margin:0">Your search, filters and place in the results are kept.</p>
          <button type="button" class="primary-btn" data-action="details-close" data-fid="removed-back">Back to results</button>
        </div>
      </div>`;
    }
    const d = D.details[l.id] || {};
    const title = d.title || l.title;
    const isCar = l.miles != null;
    const facts = isCar
      ? D.factLabels.map(k => [k, (d.facts && d.facts[k]) || (k === 'Mileage' ? l.detail : null)])
      : [['Details', l.detail], ['Condition', null]];
    const rows = [];
    for (let i = 0; i < facts.length; i += 2) {
      rows.push(`<div class="facts-row">${facts.slice(i, i + 2).map(([k, v]) => `<div class="fact"><span class="t-foot c2">${esc(k)}</span><span class="${v ? 't-title3' : 'fact-missing'}">${esc(v || 'Not provided')}</span></div>`).join('')}</div>`);
    }
    const count = d.photoCount || 1;
    const isSaved = saved.includes(l.id);
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
          <p class="t-sub c2" style="margin:0">Posted ${l.hours} hr ago${l.seller ? ` • By ${l.seller.toLowerCase()}` : ''}</p>
        </div>
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
      <div class="contact-fade"></div>
      <div class="contact">
        <p class="t-sub c2" style="margin:0">Confirm availability and the meeting location with the seller. Inspect the ${isCar ? 'vehicle' : 'item'} before paying.</p>
        ${unavailable('primary-btn', 'Contact seller', 'Contact seller')}
      </div>
    </div>`;
  }

  const SCREENS = { home: screenDiscovery, browse: screenDiscovery, results: screenDiscovery, search: screenSearch, details: screenDetails };

  // ---------- Sheets ----------

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

  // Category picker: Cars & trucks works; the selected row (or Close) means no change; other categories aren't built.
  function sheetCategory() {
    const row = (c, last) => {
      const selected = c.id === state.category;
      const inner = `<span class="crow-label">${esc(c.label)}</span>${selected ? icon('checkmark', 'ic-check') : ''}${c.chevron ? icon('chevron', 'ic-chevron') : ''}`;
      const cls = `crow t-body ${selected ? 'is-selected' : ''} ${last ? 'no-sep' : ''}`;
      if (c.id === 'cars-trucks' || selected) {
        return `<li><button type="button" class="${cls} inset-focus" data-action="category-pick" data-id="${c.id}" aria-current="${selected}">${inner}</button></li>`;
      }
      return `<li>${unavailable(cls, inner, c.label)}</li>`;
    };
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
  const contextLine = extra => `<p class="t-foot c2" id="sheet-context" style="margin:0">${esc([state.query, catLabel(state.category), D.location.label, `${D.radius} miles`, extra].filter(Boolean).join(' · '))}</p>`;

  function sheetPrice() {
    const p = state.price.draft;
    return sheetFrame('Price', `${contextLine()}
      <form class="price-fields" data-form="price" action="#" novalidate>
        ${moneyField('min', 'Minimum', 'No min', p.min)}${moneyField('max', 'Maximum', 'No max', p.max)}
        <button type="submit" hidden tabindex="-1"></button>
      </form>
      <div class="price-actions">
        <button type="button" class="text-btn" data-action="price-clear" ${hasPrice(p) ? '' : 'disabled'}>Clear price</button>
        <button type="button" class="primary-btn" data-action="price-apply">Apply</button>
      </div>`);
  }

  // Filters: segmented Seller type and Mileage; Apply reads "Show N results" from the draft.
  function segmented(name, label, options, value) {
    return `<fieldset class="seg-group"><legend class="t-headline">${label}</legend>
      <div class="segmented" role="radiogroup" aria-label="${label}">
        ${options.map(o => `<label class="seg ${o.id === value ? 'is-on' : ''}"><input type="radio" name="${name}" value="${o.id == null ? '' : o.id}" ${o.id === value ? 'checked' : ''}><span>${esc(o.label)}</span></label>`).join('')}
      </div></fieldset>`;
  }
  function draftCount() { return compute({ seller: state.seller.draft, mileage: state.mileage.draft }).length; }
  function sheetFilters() {
    const n = draftCount();
    const empty = state.seller.draft == null && state.mileage.draft == null;
    return sheetFrame('Filters', `${contextLine(priceLabel())}
      <form class="filters-form" data-form="filters" action="#" novalidate>
        ${segmented('seller', 'Seller type', D.sellers, state.seller.draft)}
        ${segmented('mileage', 'Mileage', D.mileages, state.mileage.draft)}
        <p class="t-foot c2" style="margin:0">Choose a seller type or mileage to narrow the list. Listings that don’t state that detail are hidden while the filter is on.</p>
        <button type="submit" hidden tabindex="-1"></button>
      </form>
      <div class="price-actions">
        <button type="button" class="text-btn" data-action="filters-clear" ${empty ? 'disabled' : ''}>Clear all</button>
        <button type="button" class="primary-btn" data-action="filters-apply" data-count>Show ${plural(n, 'result')}</button>
      </div>`);
  }

  const SHEETS = { category: sheetCategory, price: sheetPrice, filters: sheetFilters };

  // ---------- Rendering ----------

  function render({ resetScroll = false } = {}) {
    const prevList = $('[data-scroll="list"]'), prevFilters = $('.filters');
    const keep = !resetScroll && isDiscovery() && appEl.dataset.screen && isDiscovery(appEl.dataset.screen);
    const listY = keep && prevList ? prevList.scrollTop : 0, filterX = keep && prevFilters ? prevFilters.scrollLeft : 0;
    if (isDiscovery()) state.mapScale = mapFrame().s;
    screenEl.innerHTML = SCREENS[state.screen]();
    appEl.classList.toggle('on-home', state.screen === 'home');
    appEl.dataset.screen = state.screen;
    if (isDiscovery()) {
      applyFrame({ animate: false });
      const list = $('[data-scroll="list"]'), filters = $('.filters');
      if (list) list.scrollTop = listY;
      if (filters) filters.scrollLeft = filterX;
    } else { delete appEl.dataset.view; }
    renderOverlay();
  }
  function renderOverlay() {
    const o = state.overlay;
    overlayEl.innerHTML = o ? SHEETS[o.type]() : '';
    screenEl.inert = !!o;
    appEl.classList.toggle('has-sheet', !!o);
  }
  function focusFid(fid) {
    if (!fid) return false;
    const el = appEl.querySelector(`[data-fid="${fid}"]`);
    if (el && !el.disabled && el.getAttribute('aria-disabled') !== 'true' && el.offsetParent !== null) { el.focus({ preventScroll: true }); return true; }
    return false;
  }
  function focusFirst(c) {
    const el = c && [...c.querySelectorAll('button:not([tabindex="-1"]):not([disabled]), input, textarea, a[href]')].find(e => e.offsetParent !== null);
    if (el) el.focus({ preventScroll: true });
  }

  // returnTo: screen, view, selected marker, list scroll and filter-row position.
  function snapshot(fid) {
    const list = $('[data-scroll="list"]'), filters = $('.filters');
    return { screen: state.screen, view: state.view, pan: { ...state.pan }, selectedListingId: state.selectedListingId, expandedCluster: state.expandedCluster,
      listScrollY: list ? list.scrollTop : 0, filterRowScrollX: filters ? filters.scrollLeft : 0, fid };
  }
  function restore(snap) {
    Object.assign(state, { screen: snap.screen, view: snap.view || 'list', pan: snap.pan || { x: 0, y: 0 }, selectedListingId: snap.selectedListingId, expandedCluster: snap.expandedCluster || null });
    if (state.selectedListingId && !compute().some(l => l.id === state.selectedListingId)) state.selectedListingId = null;
    render({ resetScroll: true });
    const list = $('[data-scroll="list"]'), filters = $('.filters');
    if (list) list.scrollTop = snap.listScrollY;
    if (filters) filters.scrollLeft = snap.filterRowScrollX;
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

  // First load of a list: skeleton cards for a moment, never an empty state.
  function firstLoad(after) {
    state.loading = true;
    render({ resetScroll: true });
    setTimeout(() => {
      state.loading = false;
      render({ resetScroll: true });
      if (after) after();
    }, delay('load'));
  }

  function showList(fid, { view = 'list', load = false } = {}) {
    state.screen = listScreen();
    state.view = state.screen === 'home' ? 'list' : view;
    state.selectedListingId = null; state.expandedCluster = null; state.pan = { x: 0, y: 0 };
    const done = () => { scrollFiltersTo(hasPrice() ? 'pill-price' : null); if (!focusFid(fid)) focusFirst(screenEl); };
    if (load) firstLoad(done); else { render({ resetScroll: true }); done(); }
  }

  // ---------- Overlays ----------

  function openOverlay(type, trigger) {
    if (type === 'price') state.price.draft = { ...state.price.applied };   // drafts copy applied values
    if (type === 'filters') { state.seller.draft = state.seller.applied; state.mileage.draft = state.mileage.applied; }
    state.overlay = { type, focusReturn: trigger && trigger.dataset.fid };
    renderOverlay();
    if (type === 'price' && !hasPrice()) $('#price-max').focus();
    else {
      const sel = overlayEl.querySelector('.crow.is-selected, .seg.is-on input');
      if (sel) sel.focus(); else focusFirst(overlayEl.querySelector('[role="dialog"]'));
    }
  }
  function closeOverlay() {
    const fid = state.overlay && state.overlay.focusReturn;
    state.overlay = null;   // discard drafts
    state.price.draft = { ...state.price.applied };
    state.seller.draft = state.seller.applied; state.mileage.draft = state.mileage.applied;
    renderOverlay();
    focusFid(fid);
  }

  // ---------- Price apply (with slow / failed network simulation) ----------

  function applyPrice(price) {
    state.overlay = null;
    renderOverlay();
    state.pending = { price, status: 'applying' };
    render();
    announce(`Applying ${priceLabel(price)}`);
    const t = setTimeout(() => {
      if (!state.pending) return;
      if (sim.network === 'fail' && !sim.failedOnce) {
        sim.failedOnce = true;
        state.pending.status = 'failed';
        render();
        focusFid('retry-btn');
        announce(`Couldn't apply ${priceLabel(price)}. Showing previous results.`);
        return;
      }
      state.price.applied = { ...price };
      state.price.draft = { ...price };
      state.pending = null;
      state.selectedListingId = null; state.expandedCluster = null; state.pan = { x: 0, y: 0 };
      render({ resetScroll: true });
      scrollFiltersTo(hasPrice() ? 'pill-price' : null);
      focusFid('pill-price');
      const n = compute().length;
      announce(n ? plural(n, 'result') : 'No listings match your search.');
    }, delay('apply'));
    return t;
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
  function addRecent(query, scope) {
    const key = query.trim().toLowerCase();
    recents = [{ query, scope }, ...recents.filter(r => r.query.trim().toLowerCase() !== key || JSON.stringify(r.scope) !== JSON.stringify(scope))].slice(0, 8);
    store.set('recents-v2', recents);
  }
  function submitSearch(q, scope) {
    const query = q.trim().replace(/\s+/g, ' ');
    if (!query) return false;
    state.searchReturn = null;
    if (scope && scope.category) state.category = scope.category;
    const kw = D.categoryKeywords[query.toLowerCase()];
    if (kw) {
      addRecent('Cars', { category: 'all' });
      state.category = kw; state.query = '';
      showList('search-field', { load: true });
      return true;
    }
    state.query = query;
    // A new search keeps category, location and radius; price applies only where the recent search stored one.
    state.price.applied = scope && scope.price ? { min: scope.price.min ?? null, max: scope.price.max ?? null } : state.price.applied;
    addRecent(query, { category: state.category, ...(hasPrice() ? { price: { ...state.price.applied } } : {}) });
    showList('search-field', { load: true });
    return true;
  }

  // ---------- Actions ----------

  const actions = {
    noop() {},
    'tab-search'() { const list = $('[data-scroll="list"]'); if (list) list.scrollTo({ top: 0, behavior: 'smooth' }); },
    'sheet-close'() { closeOverlay(); },

    grabber() { actions[state.view === 'map' ? 'map-collapse' : 'map-expand'](); },

    // Category
    'open-category'(el) { openOverlay('category', el); },
    'category-pick'(el) {
      const id = el.dataset.id;
      if (id === state.category) { closeOverlay(); return; }   // same category: no change
      state.category = id;
      state.overlay = null; renderOverlay();
      showList('pill-category', { load: true });
      announce('Cars & trucks');
    },

    // Search
    'open-search'(el) { openSearch(el.dataset.fid || 'search-field'); },
    'search-cancel'() { const snap = state.searchReturn; state.searchReturn = null; restore(snap); }, // discards typed text
    'search-clear'() { const i = $('#search-input'); i.value = ''; syncEntryField(); i.focus(); },
    'search-recent'(el) {
      const r = recents[+el.dataset.index];
      if (r.query) submitSearch(r.query, r.scope);
      else { state.searchReturn = null; state.query = ''; state.category = 'cars-trucks'; showList('search-field', { load: true }); }
    },
    'recents-clear'() { recents = []; store.set('recents-v2', recents); const v = $('#search-input').value; render(); const i = $('#search-input'); i.value = v; syncEntryField(); i.focus(); },
    'results-clear'() {
      state.query = ''; state.price.applied = noPrice(); state.seller.applied = null; state.mileage.applied = null; state.pending = null;
      showList('search-field');
    },

    // Price
    'open-price'(el) { openOverlay('price', el); },
    'price-clear'() {
      state.price.draft = noPrice();   // draft only; applied stays until Apply
      overlayEl.querySelectorAll('[data-price]').forEach(i => { i.value = ''; i.closest('.money').classList.remove('has-value'); });
      overlayEl.querySelector('[data-action="price-clear"]').disabled = true;
      $('#price-max').focus();
    },
    'price-apply'() {
      const draft = { ...state.price.draft };
      if (JSON.stringify(draft) === JSON.stringify(state.price.applied)) { closeOverlay(); return; } // nothing changed
      applyPrice(draft);
    },
    'retry-apply'() { applyPrice(state.pending.price); },     // same query and filters
    'price-remove'() {
      state.price.applied = noPrice(); state.price.draft = noPrice(); state.pending = null;
      state.selectedListingId = null; state.expandedCluster = null;
      render({ resetScroll: true });
      scrollFiltersTo(null);
      focusFid('pill-price');
      announce(plural(compute().length, 'result'));
    },

    // Filters
    'open-filters'(el) { openOverlay('filters', el); },
    'filters-clear'() {
      state.seller.draft = null; state.mileage.draft = null;
      renderOverlay();
      focusFirst(overlayEl.querySelector('form'));
    },
    'filters-apply'() {
      state.seller.applied = state.seller.draft; state.mileage.applied = state.mileage.draft;
      state.overlay = null; renderOverlay();
      if (vehicleFiltered()) { state.view = 'list'; state.selectedListingId = null; }  // map isn't available here
      render({ resetScroll: true });
      scrollFiltersTo('pill-price');
      focusFid('filters-btn');
      announce(plural(compute().length, 'result'));
    },

    // Details
    'open-details'(el) {
      state.returnTo = snapshot(el.dataset.fid);
      state.details = { id: el.dataset.id };
      state.screen = 'details';
      render();
      focusFid('details-close');
    },
    'details-close'() {
      const id = state.details.id;
      if (sim.removedId === id && !state.removed.includes(id)) state.removed.push(id);   // removed: back to results without it
      const snap = state.returnTo; state.returnTo = null; state.details = null;
      if (snap.selectedListingId === id && state.removed.includes(id)) { snap.selectedListingId = null; snap.fid = null; }
      restore(snap);
    },
    'toggle-save'() {
      const id = state.details.id;
      saved = saved.includes(id) ? saved.filter(x => x !== id) : [...saved, id];
      store.set('saved-listings', saved);
      const on = saved.includes(id);
      const b = $('[data-fid="save-star"]');
      b.innerHTML = icon(on ? 'star-fill' : 'star-outline');
      b.setAttribute('aria-pressed', String(on));
      announce(on ? 'Saved to Favorites' : 'Removed from Favorites');
    },

    // Map
    'map-expand'() {
      if (!expandMapAvailable()) return;
      state.view = 'map'; render(); focusFid('map-collapse');
      announce('Map in view');
    },
    'map-collapse'() {
      state.view = 'list'; state.selectedListingId = null; state.expandedCluster = null; state.pan = { x: 0, y: 0 };
      render(); focusFid('map-toggle');
      announce('List in view');
    },
    'marker-select'(el) {
      state.selectedListingId = el.dataset.id;
      render();
      focusFid('preview-open');
      const l = byId[el.dataset.id];
      announce(`${l.title}, ${money(l.price)}, ${l.area}`);
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
  function syncFiltersUi() {
    overlayEl.querySelectorAll('.seg').forEach(s => s.classList.toggle('is-on', s.querySelector('input').checked));
    const n = draftCount();
    overlayEl.querySelector('[data-count]').textContent = `Show ${plural(n, 'result')}`;
    overlayEl.querySelector('[data-action="filters-clear"]').disabled = state.seller.draft == null && state.mileage.draft == null;
  }

  // ---------- Events ----------

  appEl.addEventListener('click', e => {
    const el = e.target.closest('[data-action]');
    if (!el || !appEl.contains(el)) { const m = e.target.closest('.money'); if (m) m.querySelector('input').focus(); return; }
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
  });
  appEl.addEventListener('input', e => {
    const t = e.target;
    if (t.id === 'search-input') { syncEntryField(); return; }
    if (t.dataset.price) {
      const digits = t.value.replace(/\D/g, '').replace(/^0+(?=\d)/, '').slice(0, 7);
      const val = digits ? parseInt(digits, 10) : null;
      state.price.draft[t.dataset.price] = val;
      t.value = val == null ? '' : val.toLocaleString('en-US');
      t.closest('.money').classList.toggle('has-value', val != null);
      overlayEl.querySelector('[data-action="price-clear"]').disabled = !hasPrice(state.price.draft);
    }
  });
  appEl.addEventListener('change', e => {
    const t = e.target;
    if (t.type === 'radio' && state.overlay && state.overlay.type === 'filters') {
      const v = t.value === '' ? null : (t.name === 'mileage' ? +t.value : t.value);
      state[t.name].draft = v;
      syncFiltersUi();
    }
  });
  document.addEventListener('keydown', e => {
    const g = document.activeElement && document.activeElement.classList.contains('grabber-btn');
    if (g && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      if (e.key === 'ArrowUp' && state.view === 'map') actions['map-collapse']();
      if (e.key === 'ArrowDown' && state.view === 'list') actions['map-expand']();
      focusFid('grabber');
      return;
    }
    if (e.key !== 'Escape') return;
    if (state.overlay) { e.preventDefault(); closeOverlay(); }
    else if (state.screen === 'search') { e.preventDefault(); actions['search-cancel'](); }
    else if (state.screen === 'details') { e.preventDefault(); actions['details-close'](); }
    else if (state.selectedListingId) { e.preventDefault(); actions['preview-dismiss'](); }
    else if (state.expandedCluster) { e.preventDefault(); actions['map-bg'](); }
  });
  overlayEl.addEventListener('touchmove', e => { if (e.target.closest('.scrim')) e.preventDefault(); }, { passive: false });

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
  }
  if (window.visualViewport) { window.visualViewport.addEventListener('resize', fitViewport); window.visualViewport.addEventListener('scroll', fitViewport); }
  window.addEventListener('resize', fitViewport);
  mobileMQ.addEventListener('change', fitViewport);
  window.addEventListener('scroll', () => { if (mobileMQ.matches && window.scrollY) window.scrollTo(0, 0); });
  appEl.addEventListener('scroll', () => { appEl.scrollTop = 0; appEl.scrollLeft = 0; });
  device.addEventListener('scroll', () => { device.scrollTop = 0; device.scrollLeft = 0; });

  // ---------- Reviewer controls (outside the app) ----------

  const netSel = document.getElementById('sim-network'), remChk = document.getElementById('sim-removed');
  if (netSel) { netSel.value = sim.network; netSel.addEventListener('change', () => { sim.network = netSel.value; sim.failedOnce = false; }); }
  if (remChk) { remChk.checked = sim.removedId === 'L01'; remChk.addEventListener('change', () => { sim.removedId = remChk.checked ? 'L01' : null; }); }
  const reset = document.getElementById('sim-reset');
  if (reset) reset.addEventListener('click', () => { state = initialState(); sim.failedOnce = false; firstLoad(); });

  window.CL_PROTO = {
    get state() { return JSON.parse(JSON.stringify(state)); },
    ids: () => compute().map(l => l.id),
    sim
  };

  fitViewport();
  firstLoad();
})();
