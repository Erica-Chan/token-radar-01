// Token Radar dashboard: renders the ranked board, a filterable table, a per-protocol
// detail view with the model's own arithmetic, and the methodology behind it.
// Reads window.TOKEN_RADAR_DATA (written by main.ts from the sealed snapshot). No network:
// no fetch, no links, no external assets of any kind.
(function () {
  var DATA = window.TOKEN_RADAR_DATA;
  var root = document.getElementById('board');
  if (!DATA || !DATA.rows) {
    root.textContent = 'No radar data was loaded.';
    root.removeAttribute('aria-busy');
    return;
  }
  var state = { q: '', category: 'all', chain: 'all', watchOnly: false, tab: 'pre-token', sort: 'implied', dir: -1, selected: null };

  // ------------------------------------------------------------ formatting
  function fmtUsd(n) {
    if (n === null || n === undefined) return '—';
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(0) + 'K';
    return '$' + n;
  }
  function fmtPct(n) {
    if (n === null || n === undefined) return '—';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days < 30) return days + 'd';
    if (days < 365) return Math.round(days / 30) + 'mo';
    return (days / 365).toFixed(1) + 'y';
  }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  // ------------------------------------------------------------ the value model
  // These three functions are the model the board is ranked by, written so the arithmetic
  // can be checked against any row. The multiples and bounds come from DATA, which main.ts
  // computed from the snapshot's own live-token protocols at build time.
  function multipleFor(category) {
    var peer = null;
    for (var i = 0; i < DATA.peers.length; i++) {
      if (DATA.peers[i].category === (category || 'Other')) peer = DATA.peers[i];
    }
    if (peer) return { multiple: peer.multiple, peers_n: peer.live_n };
    return { multiple: DATA.overall_median_mctvl, peers_n: 0 };
  }
  function growthMult(change7d) {
    var pct = change7d === null || change7d === undefined ? 0 : change7d;
    pct = Math.min(DATA.growth_high, Math.max(DATA.growth_low, pct));
    return 1 + (pct / 100) * DATA.model.growth_weight;
  }
  function maturityMult(ageDays) {
    var age = ageDays === null || ageDays === undefined ? DATA.model.unknown_age_days : ageDays;
    return DATA.model.maturity_floor + DATA.model.maturity_range * (Math.log(1 + Math.max(age, 0)) / Math.log(1 + DATA.model.maturity_days));
  }
  /** Recompute one row's implied value from its own figures: TVL x multiple x growth x maturity. */
  function impliedOf(row) {
    var m = multipleFor(row.category);
    return Math.max(1, Math.round(row.tvl_usd * m.multiple * growthMult(row.change_7d) * maturityMult(row.age_days)));
  }

  // ------------------------------------------------------------ state from the hash and query
  // Filters are shareable: ?category=RWA&chain=Ethereum&watch=1&tab=live opens a filtered
  // view directly, and #/protocol/<slug> opens one protocol's detail view.
  function readSearch() {
    var q = new URLSearchParams(window.location.search || '');
    var cat = q.get('category');
    if (cat) state.category = cat;
    var ch = q.get('chain');
    if (ch) state.chain = ch;
    if (q.get('watch') === '1') state.watchOnly = true;
    if (q.get('tab') === 'live') state.tab = 'live';
    var s = q.get('q');
    if (s) state.q = s;
  }
  function readHash() {
    var h = window.location.hash || '';
    var m = h.match(/^#\/protocol\/([A-Za-z0-9._-]+)/);
    state.selected = m ? decodeURIComponent(m[1]) : null;
  }
  function writeHash() {
    var h = state.selected ? '#/protocol/' + encodeURIComponent(state.selected) : '#/';
    if (window.location.hash !== h) window.history.replaceState(null, '', h);
  }
  window.addEventListener('hashchange', function () { readHash(); render(); });

  // ------------------------------------------------------------ filtering and sorting
  function watchlistSet() {
    var s = {};
    // The watchlist is the 40 rows whose TVL is at or above the floor; they carry the marker.
    for (var i = 0; i < DATA.rows.length; i++) if (DATA.rows[i].tvl_usd >= DATA.floor_usd) s[DATA.rows[i].slug] = true;
    return s;
  }
  var WATCH = watchlistSet();
  function rows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.watchOnly && !WATCH[r.slug]) return false;
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
      if (state.chain !== 'all' && r.chains.indexOf(state.chain) < 0) return false;
      if (q && (r.name + ' ' + r.slug + ' ' + (r.category || '')).toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var va, vb;
      if (key === 'implied') { va = a.implied_value_usd; vb = b.implied_value_usd; }
      else if (key === 'tvl') { va = a.tvl_usd; vb = b.tvl_usd; }
      else if (key === 'growth') { va = a.change_7d === null ? -9999 : a.change_7d; vb = b.change_7d === null ? -9999 : b.change_7d; }
      else if (key === 'age') { va = a.age_days === null ? -1 : a.age_days; vb = b.age_days === null ? -1 : b.age_days; }
      else { va = a.rank; vb = b.rank; }
      return (va < vb ? -1 : va > vb ? 1 : (a.slug < b.slug ? -1 : 1)) * state.dir;
    });
  }
  function categories() {
    var seen = {}, out = [];
    DATA.rows.forEach(function (r) { var c = r.category || 'Other'; if (!seen[c]) { seen[c] = 1; out.push(c); } });
    return out.sort();
  }
  function chains() {
    var seen = {}, out = [];
    DATA.rows.forEach(function (r) { r.chains.forEach(function (c) { if (!seen[c]) { seen[c] = 1; out.push(c); } }); });
    return out.sort();
  }

  // ------------------------------------------------------------ rendering helpers
  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'text') node.textContent = attrs[k];
      else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
      else if (k === 'html') node.innerHTML = attrs[k];
      else node.setAttribute(k, attrs[k]);
    });
    if (children) (Array.isArray(children) ? children : [children]).forEach(function (c) { if (c) node.appendChild(c); });
    return node;
  }
  function sortHeader(key, label) {
    var arrow = state.sort === key ? (state.dir < 0 ? ' ▼' : ' ▲') : '';
    return el('th', { 'class': 'num' }, el('button', {
      type: 'button', text: label + arrow,
      onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); }
    }));
  }

  function header() {
    var top = DATA.rows[0];
    return el('header', { 'class': 'hero' }, [
      el('div', { 'class': 'eyebrow', text: 'Token Radar · DefiLlama snapshot ' + DATA.as_of }),
      el('h1', { text: 'Pre-token protocols, ranked by what a launch would be worth' }),
      el('p', {
        'class': 'lede',
        text: 'Every protocol below records no token in the snapshot. The board ranks them by an implied value computed from their own TVL, seven-day growth and track record, against the market capitalisation per dollar of TVL that live-token protocols in the same category actually trade at. It does not predict whether or when a token is issued.'
      }),
      el('div', { 'class': 'stats' }, [
        el('div', {}, [el('b', { text: String(DATA.board_size) }), el('span', { text: 'protocols ranked' })]),
        el('div', {}, [el('b', { text: String(DATA.watchlist_size) }), el('span', { text: 'on the watchlist (TVL $50M+)' })]),
        el('div', {}, [el('b', { text: String(DATA.early_size) }), el('span', { text: 'early finds below the floor' })]),
        el('div', {}, [el('b', { text: fmtUsd(top ? top.implied_value_usd : 0) }), el('span', { text: 'top implied value' })]),
        el('div', {}, [el('b', { text: DATA.overall_median_mctvl.toFixed(3) + 'x' }), el('span', { text: 'median market cap / TVL, live peers' })])
      ])
    ]);
  }

  function controls() {
    var search = el('input', { type: 'search', placeholder: 'Search name or slug…', value: state.q, 'aria-label': 'Search protocols' });
    search.addEventListener('input', function () { state.q = search.value; render(); });
    var cat = el('select', { 'aria-label': 'Filter by category' }, categories().map(function (c) {
      return el('option', { value: c, text: c });
    }));
    cat.insertBefore(el('option', { value: 'all', text: 'All categories' }), cat.firstChild);
    cat.value = state.category;
    cat.addEventListener('change', function () { state.category = cat.value; render(); });
    var ch = el('select', { 'aria-label': 'Filter by chain' }, chains().map(function (c) {
      return el('option', { value: c, text: c });
    }));
    ch.insertBefore(el('option', { value: 'all', text: 'All chains' }), ch.firstChild);
    ch.value = state.chain;
    ch.addEventListener('change', function () { state.chain = ch.value; render(); });
    var watch = el('label', {}, [
      el('input', { type: 'checkbox', onclick: function (e) { state.watchOnly = e.target.checked; render(); } }),
      document.createTextNode(' Watchlist only')
    ]);
    watch.querySelector('input').checked = state.watchOnly;
    var tabs = el('div', { 'class': 'tabs' }, [
      el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token board', onclick: function () { state.tab = 'pre-token'; render(); } }),
      el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live-token comparables', onclick: function () { state.tab = 'live'; render(); } })
    ]);
    return [tabs, el('div', { 'class': 'controls' }, [search, cat, ch, watch])];
  }

  function boardTable() {
    var list = sortedRows(rows());
    var head = el('thead', {}, el('tr', {}, [
      el('th', { text: 'Rank' }),
      el('th', { text: 'Protocol' }),
      el('th', { text: 'Category' }),
      el('th', { text: 'Chains' }),
      sortHeader('tvl', 'TVL'),
      sortHeader('growth', '7d'),
      sortHeader('age', 'Age'),
      sortHeader('implied', 'Implied value')
    ]));
    var body = el('tbody', {}, list.map(function (r) {
      var g = r.change_7d === null ? null : r.change_7d;
      var tr = el('tr', { 'class': WATCH[r.slug] ? 'watch' : '' }, [
        el('td', { 'class': 'num', text: '#' + r.rank }),
        el('td', { 'class': 'name' }, [
          el('b', { text: r.name }),
          el('span', { text: r.slug + (WATCH[r.slug] ? ' · watchlist' : '') })
        ]),
        el('td', {}, el('span', { 'class': 'pill', text: r.category || 'Other' })),
        el('td', { text: r.chains.slice(0, 3).join(', ') + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '') }),
        el('td', { 'class': 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { 'class': 'num ' + (g === null ? '' : g >= 0 ? 'up' : 'down'), text: fmtPct(g) }),
        el('td', { 'class': 'num', text: fmtAge(r.age_days) }),
        el('td', { 'class': 'num', text: fmtUsd(r.implied_value_usd) })
      ]);
      tr.addEventListener('click', function () { state.selected = r.slug; writeHash(); render(); });
      return tr;
    }));
    if (list.length === 0) {
      return [el('div', { 'class': 'empty' }, [
        el('h2', { text: 'No protocol matches that filter' }),
        el('button', { 'class': 'button', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.watchOnly = false; render(); } })
      ])];
    }
    return [el('p', { 'class': 'count', text: list.length + ' of ' + DATA.board_size + ' protocols · click a row for its detail view and farm plan' }),
      el('table', { 'class': 'board' }, [head, body])];
  }

  function liveTable() {
    var head = el('thead', {}, el('tr', {}, [
      el('th', { text: 'Protocol' }), el('th', { text: 'Category' }),
      el('th', { 'class': 'num', text: 'TVL' }), el('th', { 'class': 'num', text: 'Market cap' }),
      el('th', { 'class': 'num', text: 'MC / TVL' })
    ]));
    var body = el('tbody', {}, DATA.live.map(function (r) {
      return el('tr', {}, [
        el('td', { 'class': 'name' }, [el('b', { text: r.name }), el('span', { text: r.slug })]),
        el('td', {}, el('span', { 'class': 'pill', text: r.category || 'Other' })),
        el('td', { 'class': 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { 'class': 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', { 'class': 'num', text: r.mctvl.toFixed(3) + 'x' })
      ]);
    }));
    return [el('p', { 'class': 'count', text: 'The 24 largest live-token protocols by market cap. These are the comparables the multiples are learned from — they already trade, so the board shows the market’s own value for them, never a model’s.' }),
      el('table', { 'class': 'board' }, [head, body])];
  }

  function detailView() {
    var row = null;
    for (var i = 0; i < DATA.rows.length; i++) if (DATA.rows[i].slug === state.selected) row = DATA.rows[i];
    if (!row) return null;
    var recomputed = impliedOf(row);
    var m = multipleFor(row.category);
    var box = el('div', { 'class': 'modelbox' }, [
      el('div', { html: '<b>Implied value, recomputed:</b> ' + esc(fmtUsd(row.tvl_usd)) + ' TVL × ' + m.multiple.toFixed(3) + ' multiple × ' + growthMult(row.change_7d).toFixed(3) + ' growth × ' + maturityMult(row.age_days).toFixed(3) + ' maturity = <b>' + esc(fmtUsd(recomputed)) + '</b>' }),
      el('div', { text: 'Stored value: ' + fmtUsd(row.implied_value_usd) + (recomputed === row.implied_value_usd ? ' — the recomputation matches.' : ' — differs from the recomputation; see the methodology.') }),
      el('div', { text: 'Multiple: ' + m.multiple.toFixed(3) + 'x from ' + m.peers_n + ' live peer' + (m.peers_n === 1 ? '' : 's') + ' in ' + (row.category || 'Other') + ', shrunk toward the overall median ' + DATA.overall_median_mctvl.toFixed(3) + 'x.' })
    ]);
    return el('section', { 'class': 'detail' }, [
      el('h2', { text: '#' + row.rank + ' · ' + row.name }),
      el('p', { 'class': 'sub', text: row.slug + ' · ' + (row.category || 'Other') + ' · ' + row.chains.join(', ') + (WATCH[row.slug] ? ' · on the watchlist' : ' · early find below the floor') }),
      el('div', { 'class': 'grid' }, [
        el('div', {}, [el('b', { text: fmtUsd(row.implied_value_usd) }), el('span', { text: 'implied value (model)' })]),
        el('div', {}, [el('b', { text: fmtUsd(row.tvl_usd) }), el('span', { text: 'TVL' })]),
        el('div', {}, [el('b', { text: fmtPct(row.change_7d) }), el('span', { text: 'TVL change, 7 days' })]),
        el('div', {}, [el('b', { text: fmtAge(row.age_days) }), el('span', { text: 'tracked since listing' })]),
        el('div', {}, [el('b', { text: row.listed_at || 'unknown' }), el('span', { text: 'first tracked' })])
      ]),
      el('h3', { text: 'How the value is built' }),
      box,
      el('h3', { text: 'Farm plan — what to do about it' }),
      el('ol', { 'class': 'steps' }, row.farm_steps.map(function (s) { return el('li', { text: s }); })),
      el('p', { 'class': 'note', text: 'This protocol records no token in the snapshot. That is a record, not a promise: a launch is the protocol’s own decision, and no step here guarantees an airdrop. Position sizes are suggestions for a single wallet, not advice.' }),
      el('button', { 'class': 'button ghost', type: 'button', text: 'Back to the board', onclick: function () { state.selected = null; writeHash(); render(); } })
    ]);
  }

  function methodSection() {
    var peerRows = DATA.peers.filter(function (p) { return p.live_n > 0; }).sort(function (a, b) { return b.multiple - a.multiple; });
    var table = el('table', { 'class': 'peers' }, [
      el('thead', {}, el('tr', {}, [el('th', { text: 'Category' }), el('th', { text: 'Live peers' }), el('th', { text: 'Median MC / TVL' }), el('th', { text: 'Multiple used' })])),
      el('tbody', {}, peerRows.map(function (p) {
        return el('tr', {}, [
          el('td', { text: p.category }),
          el('td', { text: String(p.live_n) }),
          el('td', { text: p.median_mctvl === null ? '—' : p.median_mctvl.toFixed(3) + 'x' }),
          el('td', { text: p.multiple.toFixed(3) + 'x' })
        ]);
      }))
    ]);
    return el('section', { 'class': 'method' }, [
      el('h2', { text: 'Method — how the radar works' }),
      el('p', { html: '<b>Implied value = TVL × category multiple × growth × maturity.</b> The multiple is the median market cap per dollar of TVL of live-token protocols in the same category, shrunk toward the overall median ' + esc(DATA.overall_median_mctvl.toFixed(3)) + 'x with a prior weight of 10 — a category with one peer keeps almost none of its own median, one with fifteen keeps most of it. Each peer’s own ratio is capped at the 95th percentile (' + esc(DATA.ratio_cap.toFixed(2)) + 'x) before any median is taken, so one token with a near-zero TVL cannot set its whole category’s multiple. Categories with no live peer use the overall median.' }),
      el('p', { text: 'Growth is the seven-day TVL change, winsorised at the snapshot’s own 1st and 99th percentiles (' + DATA.growth_low.toFixed(2) + '% to ' + DATA.growth_high.toFixed(2) + '%), then weighted by 0.5: a week’s spike adjusts a ranking, it never decides one. Maturity is a log-saturation durability factor from 0.7 for a brand-new protocol to 1.0 at three years of track record.' }),
      el('h3', { text: 'The comparables behind the multiples' }),
      table,
      el('p', { text: 'Only 144 of the snapshot’s 758 protocols carry a market cap, so some categories rest on few peers — the table shows the count, and the shrinkage above is what keeps a one-peer category from setting a wild multiple.' }),
      el('h3', { text: 'What this model does not do' }),
      el('p', { text: 'It does not predict whether or when a token is issued, and it is not a price forecast. The snapshot carries no revenue or fees, so the revenue multiples analysts prefer (price-to-sales, price-to-fees) cannot be computed from it; and it carries no fully diluted valuation or supply, so the implied value is an implied circulating market capitalisation, not an FDV. Farm plans use the market’s usual framing — a first community allocation is most often around 10% of supply — only as a reference, never as a promise.' })
    ]);
  }

  function render() {
    root.setAttribute('aria-busy', 'true');
    root.innerHTML = '';
    var parts = [header()];
    var ctl = controls();
    parts.push(ctl[0], ctl[1]);
    var detail = state.selected ? detailView() : null;
    if (detail) parts.push(detail);
    parts.push.apply(parts, state.tab === 'live' ? liveTable() : boardTable());
    parts.push(methodSection());
    parts.push(el('footer', { text: 'Token Radar · snapshot ' + DATA.as_of + ' · ' + DATA.source + ' · model ' + DATA.model_version + ' · figures are the snapshot’s own; “records no token” means the snapshot records none.' }));
    parts.forEach(function (p) { root.appendChild(p); });
    root.removeAttribute('aria-busy');
    if (state.selected) {
      var d = root.querySelector('.detail');
      if (d) d.scrollIntoView();
    }
  }

  readSearch();
  readHash();
  render();
})();
