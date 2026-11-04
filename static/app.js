(() => {
  'use strict';
  const published = document.documentElement.dataset.hosting === 'published';
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const num = (value) => Number.isFinite(Number(value)) ? Number(value).toLocaleString('en-US') : '—';
  const money = (value) => value == null ? '—' : new Intl.NumberFormat('en-US', {style:'currency',currency:'USD',maximumFractionDigits:0}).format(value);
  const moneyShort = (value) => value == null ? '—' : new Intl.NumberFormat('en-US', {style:'currency',currency:'USD',notation:'compact',maximumFractionDigits:1}).format(value);
  const safeUrl = (value) => /^https?:\/\//i.test(value || '') ? esc(value) : '#';
  const link = (url, label) => `<a href="${safeUrl(url)}" target="_blank" rel="noreferrer">${esc(label)} ↗</a>`;
  const timeLabel = (value) => {
    if (!value) return 'Not available';
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? 'Not available' : d.toLocaleString('en-US', {month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'});
  };
  const dateLabel = (value) => {
    if (!value) return null;
    const d = new Date(`${String(value).slice(0,10)}T12:00:00`);
    return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
  };
  function readSaved(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } }
  function save(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { showNotice('Your changes could not be saved in this browser.'); return false; } }
  const saved = readSaved('idaho-watch-view', {});
  let refreshTimer;
  const state = {
    category: ['legislature','statewide','ada'].includes(saved.category) ? saved.category : 'legislature',
    chamber: ['senate','house-a','house-b'].includes(saved.chamber) ? saved.chamber : 'senate',
    view: 'list',
    year: saved.ratingsAvailable && ['ratings','2024','2026'].includes(saved.year) ? saved.year : 'ratings',
    selectedId: saved.selectedId || 'sen15',
    query: '', filter: 'all', watchOnly: false, sort: 'district',
    pinned: new Set(readSaved('idaho-watch-pinned', [])),
    notes: readSaved('idaho-watch-notes', {}),
    overrides: readSaved('idaho-watch-ratings', {}), ratingFilter: 'all', ratingDrafts: {}, ratingOpen: new Set(),
    data: null, geometry: null, map: null, mapLayer: null, labelLayer: null,
    busy: false, geometryError: false, mapCategory: null,
  };
  const chamberName = (value) => ({senate:'Senate','house-a':'House A','house-b':'House B'}[value] || '');
  const partyName = (party, kind) => party || (kind === 'measure' ? 'Ballot response' : 'Nonpartisan');
  const partyShort = (party) => {
    const p = (party || '').toLowerCase();
    if (p.includes('republican')) return 'R';
    if (p.includes('democrat')) return 'D';
    if (p.includes('libertarian')) return 'L';
    if (p.includes('constitution')) return 'C';
    if (p.includes('independent') || p.includes('unaffiliated')) return 'I';
    return party || 'NP';
  };
  const partyColor = (party) => {
    const p = (party || '').toLowerCase();
    if (p.includes('republican') || p === 'rep' || p === 'r') return '#bc6658';
    if (p.includes('democrat') || p === 'dem' || p === 'd') return '#4277a5';
    if (p.includes('libertarian')) return '#af913e';
    if (p.includes('constitution')) return '#98698a';
    if (p.includes('independent') || p.includes('unaffiliated')) return '#748363';
    return '#607f7b';
  };
  const measureColors = ['#4277a5','#9874aa','#bf7752','#4f8275','#ab923f','#60728e'];
  const supportingOption = (name) => /^(yes\b|for\b|in favor\b)/i.test(name);
  const opposingOption = (name) => /^(no\b|against\b|opposed\b)/i.test(name);
  const optionColor = (candidate, kind) => kind !== 'measure' ? partyColor(candidate.party) : supportingOption(candidate.name) ? '#4f8275' : opposingOption(candidate.name) ? '#ae8355' : candidate.displayColor || measureColors[0];
  const optionBadge = (candidate, race) => supportingOption(candidate.name) ? '+' : opposingOption(candidate.name) ? '−' : String(race.candidates.indexOf(candidate) + 1);
  const categoryTitle = () => ({legislature:'The Idaho Legislature',statewide:'Statewide & ballot measures',ada:'Ada County & ACHD'}[state.category]);
  function remember() { save('idaho-watch-view', {...Object.fromEntries(['category','chamber','year','selectedId'].map(k => [k,state[k]])),ratingsAvailable:true}); }
  const ratingNames = {'toss-up':'Toss-up',likely:'Likely','very-likely':'Very likely',longshot:'Longshot','no-contest':'No real contest',unopposed:'Unopposed',unrated:'Unrated'};
  const ratingStrength = {'toss-up':0,likely:1,'very-likely':2,longshot:3,'no-contest':4,unopposed:5,unrated:6};
  const ratingOpacity = {likely:.45,'very-likely':.65,longshot:.82,'no-contest':1,unopposed:.6};
  const rosterSignature = race => JSON.stringify(race.candidates.map(c=>c.id).sort());
  function ratingFor(race) {
    const model = race.projection || {bucket:'unrated',reasons:['Rating unavailable.']};
    const override = state.overrides[race.id];
    if (race.category !== 'legislature' || model.bucket === 'unopposed' || !override || override.roster !== rosterSignature(race) || !ratingNames[override.bucket] || override.bucket === 'unopposed' || !override.reason?.trim()) return model;
    if (!['toss-up','unrated'].includes(override.bucket) && !race.candidates.some(c=>c.id===override.favoredCandidateId)) return model;
    return {...model,...override,override:true};
  }
  function ratingText(race, rating=ratingFor(race)) {
    const favored = race.candidates.find(c=>c.id===rating.favoredCandidateId);
    if (rating.bucket === 'longshot') return `Longshot: ${race.candidates.filter(c=>c.id!==favored?.id).map(c=>c.name).join(', ')}`;
    return `${ratingNames[rating.bucket] || 'Unrated'}${favored && !['toss-up','unrated'].includes(rating.bucket) ? ` · ${favored.name}` : ''}`;
  }
  function ratingColor(race) {
    const p=ratingFor(race);
    if(p.bucket==='toss-up') return '#858b95';
    if(p.bucket==='unrated') return '#b9c0ba';
    const party=race.candidates.find(c=>c.id===p.favoredCandidateId)?.party;
    return ['Republican','Democratic'].includes(party) ? partyColor(party) : '#748363';
  }
  function ratingBadge(race, compact=false) {
    const p=ratingFor(race), favored=race.candidates.find(c=>c.id===p.favoredCandidateId);
    let label;
    if (!compact) label=ratingText(race,p);
    else if (p.bucket==='longshot') label=`${partyShort(favored?.party)} favored · opposition longshot`;
    else label=`${ratingNames[p.bucket]}${favored && !['toss-up','unrated'].includes(p.bucket) ? ` · ${partyShort(favored.party)}` : ''}`;
    return `<span class="rating-badge" style="--rating-color:${ratingColor(race)}" title="${esc(ratingText(race,p))}">${esc(label)}${p.override ? ' *' : ''}</span>`;
  }
  function selectedRace() { return state.data?.races.find(r => r.id === state.selectedId); }
  function filteredRaces(rail = false) {
    const query = state.query.trim().toLowerCase();
    return (state.data?.races || []).filter(r => {
      if (r.category !== state.category) return false;
      if (rail && r.category === 'legislature' && r.chamber !== state.chamber) return false;
      if (state.watchOnly && !state.pinned.has(r.id)) return false;
      if (state.filter === 'contested' && (r.kind !== 'candidate' || r.candidates.length < 2)) return false;
      if (state.filter === 'reporting' && r.status !== 'reporting') return false;
      if (state.filter === 'awaiting' && r.status !== 'awaiting') return false;
      if (state.category === 'legislature' && state.ratingFilter !== 'all' && (state.ratingFilter === 'override' ? !ratingFor(r).override : ratingFor(r).bucket !== state.ratingFilter)) return false;
      if (query && ![r.name,r.shortName,r.district ? `district ${r.district}` : '',...r.candidates.map(c => c.name)].join(' ').toLowerCase().includes(query)) return false;
      return true;
    });
  }
  function totalsMargin(candidates, total) {
    if (!total || candidates.length < 2) return null;
    const sorted = [...candidates].sort((a,b) => b.votes - a.votes);
    return (sorted[0].votes - sorted[1].votes) / total * 100;
  }
  function raisedTotal(race) {
    const values = race.candidates.filter(c => c.finance?.raised != null).map(c => c.finance.raised);
    return values.length ? values.reduce((a,b) => a+b,0) : null;
  }
  function showNotice(message) { $('#notice').textContent = message; $('#notice').hidden = !message; }
  function togglePin(id) {
    state.pinned.has(id) ? state.pinned.delete(id) : state.pinned.add(id);
    save('idaho-watch-pinned', [...state.pinned]);
    render();
  }
  function selectRace(id, fit = false) {
    const race = state.data?.races.find(r => r.id === id);
    if (!race) return;
    state.selectedId = id;
    state.category = race.category;
    if (race.chamber) state.chamber = race.chamber;
    remember(); render();
    if (fit && state.mapLayer && race.district) {
      state.mapLayer.eachLayer(layer => {
        if (Number(layer.feature?.properties?.DISTRICT) === race.district) state.map.fitBounds(layer.getBounds(), {padding:[35,70],maxZoom:11});
      });
    }
  }
  function setCategory(category) {
    state.category = category;
    state.query = ''; $('#search').value = '';
    const races = filteredRaces(true);
    if (!races.some(r => r.id === state.selectedId)) state.selectedId = races[0]?.id || null;
    remember(); render(); fitMap();
  }
  function ensureSelection() {
    const race = selectedRace();
    if (!race || race.category !== state.category) state.selectedId = filteredRaces(true)[0]?.id || null;
  }
  function renderHeader() {
    const races = state.data.races.filter(r => r.category === state.category);
    const reporting = races.filter(r => r.status === 'reporting').length;
    const contested = races.filter(r => r.kind === 'candidate' && r.candidates.length > 1).length;
    const funding = races.filter(r => raisedTotal(r) != null).length;
    const metrics = [
      [races.length, state.category === 'legislature' ? 'Legislative races' : 'Contests to follow', state.category === 'legislature' ? '35 Senate · 70 House' : state.category === 'ada' ? 'County offices · ACHD · measures' : 'State offices · ballot measures'],
      [contested, 'Contested candidate races', 'Two or more listed candidates'],
      [reporting, 'Races reporting votes', reporting ? 'Unofficial returns' : 'Awaiting first returns'],
      [funding, 'Races with finance data', 'Officially reported amounts'],
    ];
    $('#overview').innerHTML = metrics.map(([v,label,sub]) => `<div class="metric"><div class="metric-value">${num(v)}</div><div><div class="metric-label">${esc(label)}</div><div class="metric-sub">${esc(sub)}</div></div></div>`).join('');
    for (const [category,id] of [['legislature','leg-count'],['statewide','state-count'],['ada','ada-count']]) $(`#${id}`).textContent = num(state.data.races.filter(r => r.category === category).length);
    $$('.scope-tab').forEach(b => { b.classList.toggle('active',b.dataset.category === state.category); b.setAttribute('aria-pressed',String(b.dataset.category === state.category)); });
    const m = state.data.meta;
    $('#source-status').textContent = m.fetchError ? 'Saved data · refresh unavailable' : `Source updated ${timeLabel(m.sourceUpdatedAt)}`;
    $('#status-dot').className = `status-dot${m.fetchError ? ' error' : reporting ? ' live' : ''}`;
    const startsAt = new Date(m.autoRefreshStartsAt);
    const refreshStatus = Date.now() < startsAt.getTime()
      ? `Auto-refresh paused until ${startsAt.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',timeZone:'America/Boise',timeZoneName:'short'})}`
      : `${published ? 'Checks for published updates' : 'Auto-refresh'} every ${(m.autoRefreshIntervalSeconds || 300) / 60} minutes`;
    $('#fetch-time').textContent = `Retrieved ${timeLabel(m.fetchedAt)} · ${refreshStatus} · ${published ? 'Publication timing may vary' : 'Manual refresh available'}`;
    showNotice(m.fetchError ? `Showing the last available official snapshot. ${m.fetchError}` : '');
    $('#rating-filter').hidden = state.category !== 'legislature';
    $('#watch-count').textContent = state.pinned.size;
    $('#watch-filter').classList.toggle('active',state.watchOnly);
    $('#watch-filter').setAttribute('aria-pressed',String(state.watchOnly));
  }
  function renderRail() {
    const races = filteredRaces(true);
    $('#rail-label').textContent = state.category === 'legislature' ? 'LEGISLATIVE DISTRICTS' : 'RACES & MEASURES';
    $('#rail-count').textContent = races.length;
    $('#chamber-switch').hidden = state.category !== 'legislature';
    $$('[data-chamber]').forEach(b => {b.classList.toggle('active',b.dataset.chamber === state.chamber); b.setAttribute('aria-pressed',String(b.dataset.chamber === state.chamber));});
    const scrollTop = $('#race-list').scrollTop;
    $('#race-list').innerHTML = races.length ? races.map(r => {
      const parties = [...new Set(r.candidates.map(c => c.party))];
      const dots = parties.map(p => `<i class="party-dot" style="background:${partyColor(p)}"></i>`).join('');
      const margin = totalsMargin(r.candidates,r.votes);
      const meta = r.status === 'reporting' ? `${num(r.votes)} votes${margin == null ? '' : ` · ${margin.toFixed(1)} pt`}` : r.kind === 'measure' ? 'Ballot question' : `${r.candidates.length} candidate${r.candidates.length === 1 ? '' : 's'}`;
      return `<div class="race-item${r.id === state.selectedId ? ' active' : ''}"><button class="race-pick" data-race="${esc(r.id)}" aria-pressed="${r.id === state.selectedId}"><span class="race-item-name">${esc(r.category === 'legislature' ? `District ${String(r.district).padStart(2,'0')}` : r.shortName || r.name)}</span><span class="race-item-meta">${dots} ${esc(meta)}</span>${r.category === 'legislature' ? ratingBadge(r,true) : ''}</button><button class="rail-star${state.pinned.has(r.id) ? ' pinned' : ''}" data-pin="${esc(r.id)}" aria-label="${state.pinned.has(r.id) ? 'Remove from' : 'Add to'} watchlist: ${esc(r.name)}">${state.pinned.has(r.id) ? '★' : '☆'}</button></div>`;
    }).join('') : '<div class="empty-state"><p>No races match these filters.</p><button data-clear-filters>Clear filters</button></div>';
    $('#race-list').scrollTop = scrollTop;
  }
  function renderCanvas() {
    if (!state.data) return;
    $('#canvas-title').textContent = categoryTitle();
    $('#canvas-eyebrow').textContent = state.category === 'legislature' ? '35 DISTRICTS · 105 SEATS' : state.category === 'statewide' ? 'IDAHO · STATEWIDE ELECTIONS' : 'ADA COUNTY · LOCAL ELECTIONS';
    $('#map-view').hidden = state.view !== 'map';
    $('#table-view').hidden = state.view !== 'list';
    $('#reset-map').hidden = state.view !== 'map';
    $('#zoom-district').hidden = state.view !== 'map' || state.category !== 'legislature';
    $('#zoom-district').disabled = !selectedRace()?.district;
    $('#map-button').classList.toggle('active',state.view === 'map');
    $('#list-button').classList.toggle('active',state.view === 'list');
    $('#map-button').setAttribute('aria-pressed',String(state.view === 'map'));
    $('#list-button').setAttribute('aria-pressed',String(state.view === 'list'));
    $$('[data-year]').forEach(b => {b.classList.toggle('active',b.dataset.year === state.year); b.setAttribute('aria-pressed',String(b.dataset.year === state.year)); b.hidden = state.category !== 'legislature';});
    $('#map-context').textContent = state.category === 'legislature' ? chamberName(state.chamber) : selectedRace()?.shortName || 'County view';
    if (state.view === 'map') renderMap(); else renderTable();
  }
  function renderTable() {
    const races = filteredRaces();
    const currentMargin = r => r.status === 'reporting' ? totalsMargin(r.candidates,r.votes) ?? Infinity : Infinity;
    const defaultOrder = (a,b) => (a.district || 0) - (b.district || 0) || ['senate','house-a','house-b'].indexOf(a.chamber) - ['senate','house-a','house-b'].indexOf(b.chamber);
    races.sort((a,b) => {
      if (state.sort === 'rating') return ratingStrength[ratingFor(a).bucket] - ratingStrength[ratingFor(b).bucket] || defaultOrder(a,b);
      if (state.sort === 'margin') return currentMargin(a) - currentMargin(b) || defaultOrder(a,b);
      if (state.sort === 'history') return (a.history?.marginPoints ?? Infinity) - (b.history?.marginPoints ?? Infinity) || defaultOrder(a,b);
      if (state.sort === 'fundraising') return (raisedTotal(b) ?? -1) - (raisedTotal(a) ?? -1) || defaultOrder(a,b);
      if (state.sort === 'name') return a.name.localeCompare(b.name,undefined,{numeric:true});
      return defaultOrder(a,b);
    });
    $('#table-description').textContent = `${races.length} ${state.category === 'legislature' ? 'races · all three seats' : 'contests'}`;
    $('#table-body').innerHTML = races.length ? races.map(r => {
      const candidates = [...r.candidates].sort((a,b) => b.votes-a.votes);
      const historical = r.history?.candidates?.length ? [...r.history.candidates].sort((a,b)=>b.votes-a.votes)[0] : null;
      const funds = raisedTotal(r);
      const knownFunds = r.candidates.filter(c=>c.finance?.raised != null).length;
      return `<tr data-race-row="${esc(r.id)}" class="${r.id === state.selectedId ? 'selected' : ''}"><td><button data-race="${esc(r.id)}" aria-pressed="${r.id === state.selectedId}">${esc(r.shortName || r.name)}</button><small>${r.category === 'legislature' ? esc(chamberName(r.chamber)) : esc(r.jurisdiction)}</small></td><td>${candidates.map(c => `<div class="table-candidate"><i class="party-dot" style="background:${optionColor(c,r.kind)}"></i>${esc(c.name)}${r.kind === 'candidate' ? ` <span class="muted" title="${esc(partyName(c.party,r.kind))}">(${esc(partyShort(c.party))})</span>` : ''}</div>`).join('')}</td><td class="rating-cell">${ratingBadge(r)}${ratingFor(r).bucket==='longshot' ? `<small>Favored: ${esc(r.candidates.find(c=>c.id===ratingFor(r).favoredCandidateId)?.name)}</small>` : ''}<small>${ratingFor(r).override ? 'Your rating' : r.projection?.preliminary && r.projection.bucket !== 'unrated' ? 'Preliminary model' : r.projection?.bucket === 'unopposed' ? 'Official roster' : 'No model assessment'}</small></td><td>${r.status === 'awaiting' ? '<span class="muted">Awaiting returns</span>' : `<strong>${num(r.votes)} votes</strong><small>${totalsMargin(candidates,r.votes) == null ? 'Uncontested / no margin' : `${totalsMargin(candidates,r.votes).toFixed(1)} pt margin`}</small>`}</td><td>${historical ? `${esc(historical.name)}<small>${r.history.year} · ${r.history.marginPoints == null ? 'Uncontested' : `${r.history.marginPoints.toFixed(1)} pt margin`}</small>` : '<span class="muted">Not comparable / unavailable</span>'}</td><td class="money">${funds == null ? '<span class="muted">Unavailable</span>' : `${moneyShort(funds)}<small>${knownFunds}/${r.candidates.length} candidates matched</small>`}</td></tr>`;
    }).join('') : '<tr><td colspan="6"><div class="empty-state">No races match these filters. <button data-clear-filters>Clear filters</button></div></td></tr>';
  }
  function renderDetail() {
    const race = selectedRace();
    if (!race) {$('#detail-panel').innerHTML='<div class="empty-state"><h3>Choose a race</h3><p>Select a race from the map or list to begin.</p></div>'; return;}
    const panel = $('#detail-panel');
    const oldId = panel.dataset.currentRace;
    const oldScroll = panel.scrollTop;
    const notesFocused = document.activeElement?.id === 'race-notes';
    const noteSelection = notesFocused ? [$('#race-notes').selectionStart,$('#race-notes').selectionEnd] : null;
    const ratingFocus = document.activeElement?.closest('#rating-form') ? document.activeElement.id : null;
    const ratingSelection = ratingFocus === 'rating-reason' ? [$('#rating-reason').selectionStart,$('#rating-reason').selectionEnd] : null;
    const candidates = [...race.candidates].sort((a,b)=>b.votes-a.votes);
    const awaiting = race.status === 'awaiting';
    const label = race.category === 'legislature' ? `DISTRICT ${race.district} · IDAHO LEGISLATURE` : race.category === 'ada' ? 'ADA COUNTY · LOCAL ELECTION' : 'IDAHO · STATEWIDE';
    const title = race.category === 'legislature' ? `District ${race.district} ${chamberName(race.chamber)}` : race.shortName || race.name;
    const otherSeats = race.category === 'legislature' ? state.data.races.filter(r=>r.category==='legislature' && r.district===race.district) : [];
    const achd = /achd|highway district/i.test(race.name);
    const candidateRows = candidates.map(c => {
      const color = optionColor(c,race.kind);
      const share = race.votes > 0 ? c.votes/race.votes*100 : 0;
      return `<div class="candidate"><div class="candidate-head"><div class="candidate-initial" style="color:${color};background:${color}16">${esc(race.kind === 'measure' ? optionBadge(c,race) : c.name.split(/\s+/).map(n=>n[0]).filter(Boolean).slice(0,2).join(''))}</div><div><div class="candidate-name">${esc(c.name)}</div><div class="candidate-party">${esc(partyName(c.party,race.kind))}</div></div><div class="candidate-number">${awaiting ? '—' : `${share.toFixed(1)}%`}<small>${awaiting ? 'No returns yet' : `${num(c.votes)} votes`}</small></div></div>${awaiting ? '' : `<div class="vote-track"><div class="vote-fill" style="width:${share}%;background:${color}"></div></div>`}</div>`;
    }).join('');
    const reporting = race.precinctsParticipating == null ? 'Reporting count unavailable' : `${race.precinctsReporting == null ? '—' : num(race.precinctsReporting)} / ${num(race.precinctsParticipating)} precincts reporting`;
    panel.innerHTML = `<div class="detail-heading"><div><div class="eyebrow">${esc(label)}</div><h2>${esc(title)}</h2></div><button class="detail-star${state.pinned.has(race.id) ? ' pinned' : ''}" data-pin="${esc(race.id)}" aria-label="${state.pinned.has(race.id) ? 'Remove from' : 'Add to'} watchlist">${state.pinned.has(race.id) ? '★' : '☆'}</button></div><p class="jurisdiction">${esc(race.jurisdiction)}${achd ? ' · Countywide electorate' : ''}</p>${otherSeats.length ? `<div class="seat-links">${otherSeats.map(r=>`<button data-race="${esc(r.id)}" class="${r.id===race.id?'active':''}">${esc(chamberName(r.chamber))}</button>`).join('')}</div>` : ''}<div class="result-status"><span class="status-dot${awaiting ? '' : ' live'}"></span>${awaiting ? '2026 · Awaiting official returns' : '2026 · Unofficial results'}</div>${candidateRows}<div class="reporting-line"><span>${esc(reporting)}</span><span>${awaiting ? '—' : `${num(race.votes)} votes`}</span></div>${achd ? '<p class="small-note">All Ada County voters may vote in these races. The zone identifies where the candidate resides.</p>' : ''}${historyHtml(race)}${race.history2022 ? historyHtml(race,race.history2022) : ''}${financeHtml(race)}<hr class="detail-divider"><label class="notes-label" for="race-notes">Your race notes <span id="note-status">Saved only in this browser</span></label><textarea id="race-notes" placeholder="Background, questions, things to watch…">${esc(state.notes[race.id] || '')}</textarea><div class="detail-sources">${link(state.data.meta.sourceUrl,'Official results')}${link('https://voteidaho.gov/idaho-general-election/','Ballot information')}</div>${projectionHtml(race)}`;
    panel.dataset.currentRace = race.id;
    panel.scrollTop = oldId === race.id ? oldScroll : 0;
    if (notesFocused && oldId === race.id) { $('#race-notes').focus({preventScroll:true}); $('#race-notes').setSelectionRange(...noteSelection); }
    if (ratingFocus && oldId === race.id && $(`#${ratingFocus}`)) {
      $(`#${ratingFocus}`).focus({preventScroll:true});
      if(ratingSelection) $('#rating-reason').setSelectionRange(...ratingSelection);
    }
    $('#race-notes').addEventListener('input',e=>{state.notes[race.id]=e.target.value;save('idaho-watch-notes',state.notes);});
    bindRatingForm(race);
  }
  function projectionHtml(race) {
    if(race.category !== 'legislature') return '';
    const p=ratingFor(race), model=race.projection || {bucket:'unrated',reasons:['Model unavailable.']};
    const favored=race.candidates.find(c=>c.id===p.favoredCandidateId);
    const draft=state.ratingDrafts[race.id] || (p.override ? p : {bucket:model.bucket,favoredCandidateId:model.favoredCandidateId,reason:''});
    const directional=!['toss-up','unrated'].includes(draft.bucket);
    return `<section class="projection-card" aria-label="Pre-election rating"><div class="section-label">PRE-ELECTION RATING <span>${p.override?'Your assessment':model.bucket==='unopposed'?'Official roster':'Preliminary model'}</span></div>${ratingBadge(race)}${favored && p.bucket==='longshot' ? `<p class="rating-favorite">Favored: ${esc(favored.name)}</p>` : ''}${p.override ? `<p class="override-reason">${esc(p.reason)}</p><p class="small-note">Your rating · ${esc(timeLabel(p.updatedAt))}<br>Model: ${esc(ratingText(race,model))}</p>` : ''}<ul class="rating-reasons">${(model.reasons || []).map(reason=>`<li>${esc(reason)}</li>`).join('')}</ul>${model.bucket!=='unopposed' ? `<p class="rating-caveat">Preliminary assumptions; not historically calibrated. Live returns and fundraising do not change this rating.</p><details class="model-method"><summary>How the model works</summary><p>For legislative races with exactly one Republican or Democratic candidate, the default is “No real contest” for that candidate, even with independent or minor-party opponents. This is a working assumption and can be overridden. A sole listed candidate remains “Unopposed”.</p><p>For other supported races, the model combines comparable 2024 results (two-thirds weight) and 2022 results (one-third). After blending, the final Republican–Democratic margin shifts a full five points toward Democrats: R+10 becomes R+5. The full shift also applies when only one historical year is usable. Displayed historical results stay as reported. If only one year is usable, it supplies the baseline. Within each year, for Republican–Democratic races, the seat gets three-quarters of the weight when the candidates are unchanged, or half when they change; other comparable seats in the district supply the remainder. Without district context, the seat stands alone. Without a comparable seat result, only district context is used.</p><p>Assumed margin uncertainty starts at 12 points for unchanged candidates, 16 for changed candidates, or 20 for a district-only baseline. Disagreement between seats and between years widens it further; a 2022-only baseline has at least 20-point uncertainty. A normal distribution converts the margin and uncertainty into the rating buckets. A descriptive check of 33 comparable seats found a 6.68-point root mean square change from 2022 to 2024. That single transition does not calibrate 2026 win chances; these uncertainty assumptions remain preliminary. Other same-candidate minor-party matchups use their previous margin with 16-point uncertainty; unsupported matchups remain unrated.</p><p>Fundraising periods are not yet comparable, and no polling adjustment is assumed. The five-point Democratic shift is a working assumption. Unrated means insufficient evidence, not a close race. “No real contest” is a pre-election assessment, never a winner call.</p>${(model.sources || []).map(url=>link(url,url.includes('/2022/')?'2022 official results':'2024 official results')).join(' · ')}</details>` : ''}${model.bucket!=='unopposed' ? `<details id="rating-editor" class="rating-editor" ${state.ratingOpen.has(race.id)?'open':''}><summary>${p.override?'Edit your rating':'Set your rating'}</summary><form id="rating-form"><label for="rating-bucket">Race bucket</label><select id="rating-bucket">${Object.entries(ratingNames).filter(([key])=>key!=='unopposed').map(([key,name])=>`<option value="${key}" ${draft.bucket===key?'selected':''}>${name}</option>`).join('')}</select><label for="rating-favored">Favored candidate</label><select id="rating-favored" ${directional?'required':'disabled'}><option value="">${directional?'Choose a candidate':'No favored candidate'}</option>${race.candidates.map(c=>`<option value="${esc(c.id)}" ${draft.favoredCandidateId===c.id?'selected':''}>${esc(c.name)}</option>`).join('')}</select><label for="rating-reason">Reason for your assessment</label><textarea id="rating-reason" required maxlength="600" placeholder="What changes your assessment of this race?">${esc(draft.reason || '')}</textarea><div class="rating-actions"><button type="submit">Save rating</button>${p.override?'<button type="button" id="rating-reset">Use model rating</button>':''}</div><span id="rating-save-status" role="status"></span><p class="small-note">Saved only in this browser; never shared with other visitors. An asterisk marks your ratings.</p></form></details>` : ''}</section>`;
  }
  function bindRatingForm(race) {
    const form=$('#rating-form');
    if(!form) return;
    $('#rating-editor').addEventListener('toggle',e=>{
      e.target.open ? state.ratingOpen.add(race.id) : state.ratingOpen.delete(race.id);
    });
    const draft=()=>({bucket:$('#rating-bucket').value,favoredCandidateId:$('#rating-favored').value || null,reason:$('#rating-reason').value});
    form.addEventListener('input',()=>{
      state.ratingDrafts[race.id]=draft();
      const directional=!['toss-up','unrated'].includes($('#rating-bucket').value);
      $('#rating-favored').disabled=!directional;
      $('#rating-favored').required=directional;
      $('#rating-save-status').textContent='Unsaved changes';
    });
    form.addEventListener('submit',e=>{
      e.preventDefault();
      const value=draft();
      value.reason=value.reason.trim();
      if(!value.reason) {$('#rating-save-status').textContent='Add a reason before saving.';return;}
      if(['toss-up','unrated'].includes(value.bucket)) value.favoredCandidateId=null;
      const updated={...readSaved('idaho-watch-ratings',{}),[race.id]:{...value,updatedAt:new Date().toISOString(),roster:rosterSignature(race)}};
      if(!save('idaho-watch-ratings',updated)) {$('#rating-save-status').textContent='Could not save. Your draft is still here.';return;}
      state.overrides=updated; delete state.ratingDrafts[race.id];
      state.ratingOpen.add(race.id);render();
      $('#rating-save-status').textContent='Saved in this browser';
    });
    $('#rating-reset')?.addEventListener('click',()=>{
      const updated={...readSaved('idaho-watch-ratings',{})};delete updated[race.id];
      if(!save('idaho-watch-ratings',updated)) {$('#rating-save-status').textContent='Could not reset. Your rating is still saved.';return;}
      state.overrides=updated;delete state.ratingDrafts[race.id];render();
      $('#rating-save-status').textContent='Model rating restored';
    });
  }
  function historyHtml(race, h=race.history) {
    if (!h?.candidates?.length) return `<div class="history-empty"><strong>Historical context</strong><br>${race.kind === 'measure' ? 'This measure has no directly comparable prior result. Measures with the same number in other years may be different questions.' : /achd|highway district/i.test(race.name) ? 'The electorate changed for 2026. A prior zone result is not a like-for-like countywide comparison.' : 'A comparable prior result has not been loaded for this race.'}</div>`;
    const people = [...h.candidates].sort((a,b)=>b.votes-a.votes);
    return `<div class="history-card"><div class="section-label">${h.year} RESULT <span>${num(h.totalVotes)} votes</span></div>${people.map(c=>`<div class="history-person"><i class="party-dot" style="background:${optionColor(c,race.kind)}"></i><span class="name">${esc(c.name)}</span><strong>${h.totalVotes ? (c.votes/h.totalVotes*100).toFixed(1) : '0.0'}%</strong></div>`).join('')}<div class="history-bar">${people.map(c=>`<span style="width:${h.totalVotes ? c.votes/h.totalVotes*100 : 0}%;background:${optionColor(c,race.kind)}"></span>`).join('')}</div><div class="history-caption">${h.marginPoints == null ? 'Uncontested race' : `${h.marginPoints.toFixed(1)} percentage-point margin`}${link(h.sourceUrl,'Source')}</div></div>`;
  }
  function financeHtml(race) {
    if (race.kind === 'measure') return '';
    const candidates = race.candidates;
    const known = candidates.filter(c=>c.finance && [c.finance.raised,c.finance.spent,c.finance.cashOnHand].some(v=>v!=null));
    let html = '<div class="section-label">CAMPAIGN FINANCE <span>Reported totals</span></div>';
    if (!known.length) return html + `<div class="finance-missing">Fundraising figures are not available for these candidates yet. Missing reports are not zero-dollar campaigns.</div><p class="finance-source">${link(state.data.meta.financeSourceUrl || 'https://sunshine.voteidaho.gov/','Idaho Sunshine')}</p>`;
    html += `<table class="finance-table"><thead><tr><th>Candidate</th><th>Raised</th><th>Spent</th><th>Cash</th></tr></thead><tbody>${candidates.map(c=>`<tr><td>${c.finance?.sourceUrl ? link(c.finance.sourceUrl,c.name) : esc(c.name)}${c.finance?.reportEnd ? `<small>Through ${esc(dateLabel(c.finance.reportEnd))}</small>` : ''}</td><td>${money(c.finance?.raised)}</td><td>${money(c.finance?.spent)}</td><td>${money(c.finance?.cashOnHand)}</td></tr>`).join('')}</tbody></table>`;
    const notes = [...new Set(known.map(c=>c.finance.note).filter(Boolean))];
    const periods = [...new Set(known.filter(c=>c.finance.reportStart || c.finance.reportEnd).map(c=>`${dateLabel(c.finance.reportStart) || 'Start unavailable'} – ${dateLabel(c.finance.reportEnd) || 'End unavailable'}`))];
    html += `<p class="finance-source">${periods.length ? `Reporting period: ${esc(periods.join('; '))}. ` : ''}${esc(notes.join(' '))}</p><p class="finance-source">Retrieved ${esc(timeLabel(state.data.meta.financeUpdatedAt))} · ${link(state.data.meta.financeSourceUrl || 'https://sunshine.voteidaho.gov/','Sunshine portal')}</p>`;
    if (known.length < candidates.length) html += '<p class="finance-source">— means unavailable or unmatched, not zero.</p>';
    return html;
  }
  function render() {
    if (!state.data) return;
    ensureSelection(); renderHeader(); renderRail(); renderCanvas(); renderDetail();
  }
  function mapRace(feature) {
    if (state.category !== 'legislature') return selectedRace();
    return state.data.races.find(r=>r.category==='legislature' && r.chamber===state.chamber && r.district===Number(feature.properties.DISTRICT));
  }
  function mapResult(feature) {
    const race = mapRace(feature);
    if (!race) return null;
    if (state.category === 'legislature') {
      if(state.year==='ratings') return null;
      return state.year === '2024' ? race.history && {candidates:race.history.candidates,total:race.history.totalVotes,kind:race.kind} : race.status === 'reporting' ? {candidates:race.candidates,total:race.votes,kind:race.kind} : null;
    }
    const name = String(feature.properties.NAME || '').replace(/ County$/i,'');
    const county = (race.countyResults || []).find(c=>c.county.replace(/ County$/i,'')===name);
    if (county?.votes > 0) return {candidates:county.candidates,total:county.votes,kind:race.kind};
    return null;
  }
  function featureStyle(feature) {
    const race = mapRace(feature);
    const result = mapResult(feature);
    const top = result?.total > 0 ? [...result.candidates].sort((a,b)=>b.votes-a.votes) : [];
    const tied = top.length > 1 && top[0].votes === top[1].votes;
    const selected = state.category === 'legislature' && race?.id===state.selectedId;
    const visible = state.category !== 'legislature' || filteredRaces(true).some(r=>r.id===race?.id);
    if(state.category==='legislature' && state.year==='ratings' && race) {
      const p=ratingFor(race);
      return {color:selected?'#163f3b':'#fffef8',weight:selected?2.8:1.1,
        fillColor:ratingColor(race),fillOpacity:visible?(ratingOpacity[p.bucket] ?? .8):.15,
        opacity:visible?1:.4,dashArray:p.bucket==='unopposed'?'3 3':null};
    }
    return {color:selected?'#163f3b':'#fffef8',weight:selected?2.8:1.1,fillColor:!top.length||tied?'#c9d1bf':optionColor(top[0],result.kind),fillOpacity:visible ? (top.length ? .58 + Math.min(.3,(top[0].votes/result.total)*.3) : .8) : .15,opacity:visible?1:.4};
  }
  function renderMap() {
    if (!window.L) { $('#map').innerHTML='<div class="empty-state">The map library could not be loaded. The list view is available.</div>'; return; }
    if (!state.geometry) {$('#map').innerHTML=`<div class="empty-state">${state.geometryError ? 'Map boundaries could not be loaded. Use the list view while they are unavailable.' : 'Loading district boundaries…'}</div>`;return;}
    if (!state.map) {
      $('#map').innerHTML='';
      state.map=L.map('map',{zoomControl:false,scrollWheelZoom:true,minZoom:5,maxZoom:13,zoomSnap:.1,zoomDelta:.5});
      L.control.zoom({position:'bottomright'}).addTo(state.map);
      state.map.attributionControl.setPrefix(false);
      state.map.attributionControl.addAttribution('Idaho official boundaries');
      state.map.on('zoomend moveend',renderLabels);
    }
    if(state.mapLayer) state.map.removeLayer(state.mapLayer);
    if(state.labelLayer) state.map.removeLayer(state.labelLayer);
    let geometry = state.category === 'legislature' ? state.geometry.legislative : state.geometry.counties;
    if (state.category === 'ada') geometry={type:'FeatureCollection',features:(geometry?.features || []).filter(f=>/^ada(?: county)?$/i.test(f.properties.NAME))};
    if (!geometry?.features?.length) {$('#map-footnote').textContent='Boundaries are unavailable for this view. Race details and the list remain available.';return;}
    state.mapLayer=L.geoJSON(geometry,{style:featureStyle,onEachFeature:(feature,layer)=>{
      const race=mapRace(feature), result=mapResult(feature);
      const label=state.category==='legislature'?`District ${feature.properties.DISTRICT} · ${chamberName(state.chamber)}`:feature.properties.NAME;
      const top=result?.total>0?[...result.candidates].sort((a,b)=>b.votes-a.votes)[0]:null;
      const ratingLayer=state.category==='legislature' && state.year==='ratings';
      const description=ratingLayer && race ? `${esc(ratingText(race))}<br>${ratingFor(race).override?'Your rating':ratingFor(race).bucket==='unopposed'?'Official roster':'Preliminary model'}` : top?`${esc(top.name)} · ${(top.votes/result.total*100).toFixed(1)}%`:'No reported votes in this layer';
      layer.bindTooltip(`<strong>${esc(label)}</strong><br>${description}`,{sticky:true});
      if(state.category==='legislature'&&race) layer.on('click',()=>selectRace(race.id));
      layer.on('mouseover',()=>layer.setStyle({weight:2.4,color:'#587567'}));
      layer.on('mouseout',()=>layer.setStyle(featureStyle(feature)));
    }}).addTo(state.map);
    state.mapLayer.eachLayer(layer=>{if(mapRace(layer.feature)?.id===state.selectedId&&state.category==='legislature') layer.bringToFront();});
    state.labelLayer=L.layerGroup().addTo(state.map);
    const changedCategory=state.mapCategory!==state.category;
    state.mapCategory=state.category;
    requestAnimationFrame(()=>requestAnimationFrame(()=>{state.map.invalidateSize();if(changedCategory)fitMap();else renderLabels();}));
    const baseline=state.category==='legislature'&&state.year==='2024';
    $('#map-legend').innerHTML=`<span class="legend-heading">${baseline?'2024 WINNING PARTY':'2026 REPORTED LEADER'}</span>${[['#4277a5','Democratic'],['#bc6658','Republican'],['#748363','Other / nonpartisan'],['#c9d1bf',baseline?'Unavailable':'No returns / tied']].map(([c,n])=>`<span class="legend-item"><i class="legend-swatch" style="background:${c}"></i>${n}</span>`).join('')}`;
    if(state.category==='legislature' && state.year==='ratings') {
      $('#map-legend').innerHTML=`<span class="legend-heading">PRE-ELECTION · FAVORED PARTY</span>${[['#4277a5','Democratic'],['#bc6658','Republican'],['#748363','Other'],['#858b95','Toss-up'],['#b9c0ba','Unrated']].map(([c,n])=>`<span class="legend-item"><i class="legend-swatch" style="background:${c}"></i>${n}</span>`).join('')}<div class="rating-scale">${[['likely','Likely'],['very-likely','Very likely'],['longshot','Longshot opposition'],['no-contest','No real contest']].map(([bucket,label])=>`<span><i style="background:#607f7b;opacity:${ratingOpacity[bucket]}"></i>${label}</span>`).join('')}<span>Dashed border: unopposed</span></div>`;
    }
    if(selectedRace()?.kind==='measure'&&state.category!=='legislature') {
      const race=selectedRace();
      const choices=race.candidates.map(c=>`<span class="legend-item" title="${esc(c.name)}"><i class="legend-swatch" style="background:${optionColor(c,'measure')}"></i>${esc(supportingOption(c.name)?'Yes / In favor':opposingOption(c.name)?'No / Against':c.name.length>30?c.name.slice(0,29)+'…':c.name)}</span>`).join('');
      $('#map-legend').innerHTML=`<span class="legend-heading">2026 REPORTED LEADER</span>${choices}<span class="legend-item"><i class="legend-swatch" style="background:#c9d1bf"></i>No returns / tied</span>`;
    }
    const filtered=state.query || state.filter !== 'all' || state.ratingFilter !== 'all' || state.watchOnly;
    $('#map-footnote').textContent=state.category==='legislature'?(baseline?'Historical results, not a forecast. Select a district; zoom in to explore urban seats.':'Unofficial returns. Leading does not mean elected. Select a district to explore its races.')+(filtered?' Dimmed districts do not match your filters; they remain selectable.':''):state.category==='ada'?`${selectedRace()?.jurisdiction || 'Selected contest'}. Map shows Ada County returns only.${/achd|highway district/i.test(selectedRace()?.name || '') ? ' ACHD zones describe candidate residency; both seats are elected countywide.' : ''}`:'County results for the selected contest. Leading does not mean elected.';
    if(state.category==='legislature' && state.year==='ratings') $('#map-footnote').textContent='Assumption: the final baseline shifts a full 5 points toward Democrats after blending. Darker color means a stronger favorite. Your overrides take precedence; live returns do not change ratings.'+(filtered?' Dimmed districts do not match your filters; they remain selectable.':'');
  }
  function renderLabels() {
    if(!state.mapLayer||!state.labelLayer||state.mapCategory!==state.category) return;
    state.labelLayer.clearLayers();
    const used=[];
    state.mapLayer.eachLayer(layer=>{
      const bounds=layer.getBounds(), point=state.map.latLngToContainerPoint(bounds.getCenter());
      if(used.some(p=>Math.abs(p.x-point.x)<21&&Math.abs(p.y-point.y)<16)) return;
      if(!state.map.getBounds().contains(bounds.getCenter())) return;
      used.push(point);
      const name=state.category==='legislature'?String(layer.feature.properties.DISTRICT):layer.feature.properties.NAME.replace(/ County$/i,'');
      L.marker(bounds.getCenter(),{interactive:false,icon:L.divIcon({className:'district-label',html:esc(name),iconSize:[state.category==='legislature'?22:75,16],iconAnchor:[state.category==='legislature'?11:37,8]})}).addTo(state.labelLayer);
    });
  }
  function fitMap() {
    if(!state.map||!state.mapLayer||state.view!=='map'||state.mapCategory!==state.category) return;
    const bounds=state.mapLayer.getBounds();
    if(bounds.isValid()) state.map.fitBounds(bounds,{paddingTopLeft:[22,50],paddingBottomRight:[25,22],maxZoom:state.category==='ada'?9:7});
  }
  function scheduleRefresh() {
    clearTimeout(refreshTimer);
    const startsAt = new Date(state.data?.meta.autoRefreshStartsAt || 0).getTime();
    const interval = (state.data?.meta.autoRefreshIntervalSeconds || 300) * 1000;
    const delay = startsAt > Date.now() ? startsAt - Date.now() : interval;
    refreshTimer = setTimeout(()=>fetchData(), Math.min(delay, 2147483647));
  }
  async function fetchData(refresh=false) {
    if(state.busy) return;
    state.busy=true;$('#refresh').disabled=true;
    try {
      const url = published ? `./data/results.json?v=${Date.now()}` : refresh ? '/api/refresh' : '/api/data';
      const response=await fetch(url,{method:refresh && !published?'POST':'GET',cache:'no-store'});
      const data=await response.json();
      if(!response.ok || !Array.isArray(data.races)) throw new Error(data.error || 'Official data is not available yet.');
      data.races.filter(r=>r.kind==='measure').forEach(r=>{
        r.candidates.forEach((c,index)=>{c.displayColor=measureColors[index%measureColors.length];});
        (r.countyResults||[]).forEach(county=>county.candidates.forEach(c=>{c.displayColor=r.candidates.find(option=>option.name===c.name)?.displayColor;}));
      });
      state.data=data;render();
    } catch(error) {
      showNotice(`${state.data?'Keeping the last loaded snapshot. ':''}${error.message}`);
      $('#source-status').textContent='Unable to refresh';$('#status-dot').className='status-dot error';
      if(!state.data) $('#race-list').innerHTML='<div class="empty-state"><p>Election data could not be loaded.</p><button data-retry>Try again</button></div>';
    } finally {state.busy=false;$('#refresh').disabled=false;scheduleRefresh();}
  }
  async function fetchGeometry() {
    try {
      const response=await fetch(published ? './data/geometry.json' : '/api/geometry');
      if(!response.ok) throw new Error('Unavailable');
      state.geometry=await response.json();
      if(state.data&&state.view==='map') renderMap();
    } catch {state.geometryError=true;if(state.data&&state.view==='map')renderMap();}
  }
  document.addEventListener('click',e=>{
    const race=e.target.closest('[data-race], [data-race-row]');if(race){selectRace(race.dataset.race || race.dataset.raceRow);return;}
    const pin=e.target.closest('[data-pin]');if(pin){togglePin(pin.dataset.pin);return;}
    const category=e.target.closest('[data-category]');if(category){setCategory(category.dataset.category);return;}
    const chamber=e.target.closest('[data-chamber]');if(chamber){const district=selectedRace()?.district;state.chamber=chamber.dataset.chamber;state.selectedId=state.data?.races.find(r=>r.category==='legislature'&&r.chamber===state.chamber&&r.district===district)?.id || filteredRaces(true)[0]?.id;remember();render();return;}
    const year=e.target.closest('[data-year]');if(year){state.year=year.dataset.year;remember();renderCanvas();return;}
    if(e.target.closest('[data-clear-filters]')){state.query='';state.filter='all';state.ratingFilter='all';state.watchOnly=false;$('#search').value='';$('#race-filter').value='all';$('#rating-filter').value='all';render();return;}
    if(e.target.closest('[data-retry]'))fetchData(true);
  });
  $('#search').addEventListener('input',e=>{state.query=e.target.value;renderRail();renderCanvas();});
  $('#race-filter').addEventListener('change',e=>{state.filter=e.target.value;render();});
  $('#rating-filter').addEventListener('change',e=>{state.ratingFilter=e.target.value;render();});
  $('#watch-filter').addEventListener('click',()=>{state.watchOnly=!state.watchOnly;render();});
  $('#sort').addEventListener('change',e=>{state.sort=e.target.value;renderTable();});
  $('#map-button').addEventListener('click',()=>{state.view='map';remember();renderCanvas();});
  $('#list-button').addEventListener('click',()=>{state.view='list';remember();renderCanvas();});
  $('#reset-map').addEventListener('click',fitMap);
  $('#zoom-district').addEventListener('click',()=>{if(state.selectedId)selectRace(state.selectedId,true);});
  $('#refresh').addEventListener('click',()=>fetchData(true));
  window.addEventListener('resize',()=>state.map?.invalidateSize());
  window.addEventListener('storage',e=>{
    if(e.key==='idaho-watch-ratings' || e.key===null) {
      state.overrides=readSaved('idaho-watch-ratings',{});render();
    }
  });
  if (published) {
    $('#refresh').title = 'Load latest published results';
    $('#refresh').setAttribute('aria-label', 'Load latest published results');
  }
  fetchData();fetchGeometry();
})();
