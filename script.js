const STORAGE_KEY = 'marginal_discount_simulator_grayscale_v1';
const SCENARIO_LIMIT = 10;
const TIER_COLORS = [
  'rgba(255,255,255,.22)',
  'rgba(167,139,250,.56)',
  'rgba(103,232,249,.52)',
  'rgba(74,222,128,.48)',
  'rgba(255,255,255,.12)',
  'rgba(255,255,255,.18)'
];

let scenarios = [];
let nextScenarioId = 1;
let nextTierId = 1;
let toastEl = null;
const comparisonDebounce = {};
const saveDebounce = {};

function num(v, fallback = 0) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmtTL(val) {
  const n = Number.isFinite(val) ? val : 0;
  return new Intl.NumberFormat('tr-TR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(n) + ' TL';
}

function fmtPct(val) {
  const n = Number.isFinite(val) ? val : 0;
  return new Intl.NumberFormat('tr-TR', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1
  }).format(n) + '%';
}

function fmtNum(val) {
  const n = Number.isFinite(val) ? val : 0;
  return new Intl.NumberFormat('tr-TR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(n);
}

function newTier(from = 0, to = 5000, rate = 10) {
  return { id: nextTierId++, from, to, rate };
}

function normalizeScenario(sc) {
  sc.listPrice = Math.max(0, num(sc.listPrice, 0));
  sc.marginPct = clamp(num(sc.marginPct, 0), 0, 100);
  sc.name = String(sc.name ?? '').trim() || `Senaryo ${sc.id}`;

  if (!Array.isArray(sc.tiers) || sc.tiers.length === 0) {
    sc.tiers = [newTier(0, 5000, 10)];
  }

  sc.tiers = sc.tiers.map(t => ({
    id: Number.isFinite(+t.id) ? +t.id : nextTierId++,
    from: Math.max(0, num(t.from, 0)),
    to: (t.to === null || t.to === '' || typeof t.to === 'undefined') ? null : Math.max(0, num(t.to, 0)),
    rate: clamp(num(t.rate, 0), 0, 100)
  }));

  sc.tiers.sort((a, b) => {
    if ((a.from ?? 0) !== (b.from ?? 0)) return (a.from ?? 0) - (b.from ?? 0);
    const at = a.to === null ? Infinity : a.to;
    const bt = b.to === null ? Infinity : b.to;
    if (at !== bt) return at - bt;
    return a.id - b.id;
  });

  let prevEnd = 0;
  sc.tiers.forEach((tier, index) => {
    if (index === 0) {
      tier.from = Math.max(0, tier.from);
    } else {
      tier.from = prevEnd;
    }

    if (tier.to === null) {
      if (index !== sc.tiers.length - 1) tier.to = tier.from + 5000;
    } else {
      tier.to = Math.max(tier.from, tier.to);
    }

    prevEnd = tier.to === null ? Infinity : tier.to;
  });

  return sc;
}

function createScenario(base = {}) {
  const id = nextScenarioId++;
  return normalizeScenario({
    id,
    name: `Senaryo ${id}`,
    listPrice: 10000,
    marginPct: 35,
    tiers: [newTier(0, 5000, 10)],
    detailOpen: false,
    ...base
  });
}

function calculateDiscount(listPrice, tiers) {
  if (!(listPrice > 0) || !Array.isArray(tiers) || tiers.length === 0) return 0;

  const normalized = [...tiers].sort((a, b) => {
    if ((a.from ?? 0) !== (b.from ?? 0)) return (a.from ?? 0) - (b.from ?? 0);
    const at = a.to === null ? Infinity : a.to;
    const bt = b.to === null ? Infinity : b.to;
    return at - bt;
  });

  let total = 0;
  for (const tier of normalized) {
    const from = Math.max(0, num(tier.from, 0));
    const to = tier.to === null ? Infinity : Math.max(from, num(tier.to, Infinity));
    const slab = Math.max(0, Math.min(listPrice, to) - from);
    if (slab > 0) total += slab * (num(tier.rate, 0) / 100);
    if (to >= listPrice) break;
  }
  return total;
}

function calculateScenario(sc) {
  const listPrice = num(sc.listPrice, 0);
  const marginPct = clamp(num(sc.marginPct, 0), 0, 100);
  const baseCost = listPrice * (1 - marginPct / 100);
  const discount = calculateDiscount(listPrice, sc.tiers);
  const finalPrice = Math.max(0, listPrice - discount);
  const effectivePct = listPrice > 0 ? (discount / listPrice) * 100 : 0;
  const netProfit = finalPrice - baseCost;
  const newMargin = finalPrice > 0 ? (netProfit / finalPrice) * 100 : 0;

  const sorted = [...sc.tiers].sort((a, b) => {
    if ((a.from ?? 0) !== (b.from ?? 0)) return (a.from ?? 0) - (b.from ?? 0);
    const at = a.to === null ? Infinity : a.to;
    const bt = b.to === null ? Infinity : b.to;
    return at - bt;
  });

  const tierDetails = sorted.map((tier, i) => {
    const from = Math.max(0, num(tier.from, 0));
    const to = tier.to === null ? Infinity : Math.max(from, num(tier.to, Infinity));
    const slab = Math.max(0, Math.min(listPrice, to) - from);
    const tierDiscount = slab * (num(tier.rate, 0) / 100);
    return { num: i + 1, from, to, slab, rate: num(tier.rate, 0), tierDiscount };
  });

  return {
    listPrice,
    marginPct,
    baseCost,
    discount,
    finalPrice,
    effectivePct,
    netProfit,
    newMargin,
    tierDetails
  };
}

function saveState() {
  clearTimeout(saveDebounce.persist);
  saveDebounce.persist = setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        scenarios,
        nextScenarioId,
        nextTierId
      }));
    } catch (_) {}
  }, 100);
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const data = JSON.parse(raw);
    if (!data || !Array.isArray(data.scenarios)) return false;

    scenarios = data.scenarios.map(sc => normalizeScenario(sc));
    nextScenarioId = Number.isFinite(data.nextScenarioId)
      ? data.nextScenarioId
      : (Math.max(0, ...scenarios.map(s => s.id)) + 1);

    nextTierId = Number.isFinite(data.nextTierId)
      ? data.nextTierId
      : Math.max(1, ...scenarios.flatMap(s => (s.tiers || []).map(t => t.id))) + 1;

    scenarios.forEach(sc => {
      if (typeof sc.detailOpen !== 'boolean') sc.detailOpen = false;
    });

    return true;
  } catch (_) {
    return false;
  }
}

function updateAddButton() {
  const btn = document.getElementById('btn-add-scenario');
  btn.disabled = scenarios.length >= SCENARIO_LIMIT;
  btn.textContent = scenarios.length >= SCENARIO_LIMIT ? 'Maksimum Senaryo' : '＋ Senaryo Ekle';
}

function queueComparisonUpdate() {
  clearTimeout(comparisonDebounce.run);
  comparisonDebounce.run = setTimeout(updateComparisonTable, 60);
}

function showToast(message) {
  if (toastEl) toastEl.remove();
  toastEl = document.createElement('div');
  toastEl.className = 'toast';
  toastEl.textContent = message;
  document.body.appendChild(toastEl);
  setTimeout(() => {
    if (toastEl) {
      toastEl.remove();
      toastEl = null;
    }
  }, 2350);
}

function addScenario(base) {
  if (scenarios.length >= SCENARIO_LIMIT) return;
  scenarios.push(createScenario(base));
  renderAllCards();
  updateAddButton();
  saveState();
}

function deleteScenario(id) {
  if (scenarios.length <= 1) return;
  scenarios = scenarios.filter(s => s.id !== id);
  renderAllCards();
  updateAddButton();
  saveState();
}

function copyScenario(id) {
  if (scenarios.length >= SCENARIO_LIMIT) return;
  const src = scenarios.find(s => s.id === id);
  if (!src) return;

  const clone = JSON.parse(JSON.stringify(src));
  const normalizedClone = normalizeScenario({
    ...clone,
    id: nextScenarioId++,
    name: `${src.name} (Kopya)`,
    detailOpen: false,
    tiers: (clone.tiers || []).map(t => ({
      ...t,
      id: nextTierId++
    }))
  });

  scenarios.push(normalizedClone);
  renderAllCards();
  updateAddButton();
  saveState();
  showToast('Senaryo kopyalandı.');
}

function updateScenarioField(id, field, rawValue) {
  const sc = scenarios.find(s => s.id === id);
  if (!sc) return;

  if (field === 'name') sc.name = String(rawValue);
  else sc[field] = rawValue;

  normalizeScenario(sc);
  queueComparisonUpdate();
  saveState();
}

function commitScenario(id) {
  const sc = scenarios.find(s => s.id === id);
  if (!sc) return;
  refreshCard(id);
  updateComparisonTable();
  saveState();
}

function updateTierField(scId, tierId, field, rawValue) {
  const sc = scenarios.find(s => s.id === scId);
  if (!sc) return;

  const tier = sc.tiers.find(t => t.id === tierId);
  if (!tier) return;

  if (field === 'to') {
    tier.to = rawValue === null || rawValue === '' || typeof rawValue === 'undefined' ? null : rawValue;
  } else {
    tier[field] = rawValue;
  }

  normalizeScenario(sc);
  queueComparisonUpdate();
  saveState();
}

function addTier(scId) {
  const sc = scenarios.find(s => s.id === scId);
  if (!sc) return;

  const sorted = [...sc.tiers].sort((a, b) => {
    if ((a.from ?? 0) !== (b.from ?? 0)) return (a.from ?? 0) - (b.from ?? 0);
    const at = a.to === null ? Infinity : a.to;
    const bt = b.to === null ? Infinity : b.to;
    return at - bt;
  });

  const last = sorted[sorted.length - 1];
  const start = last.to === null ? (last.from ?? 0) + 5000 : last.to;

  if (last.to === null) last.to = start;

  sc.tiers.push(newTier(start, start + 5000, 10));
  normalizeScenario(sc);
  refreshCard(scId);
  updateComparisonTable();
  saveState();
}

function deleteTier(scId, tierId) {
  const sc = scenarios.find(s => s.id === scId);
  if (!sc || sc.tiers.length <= 1) return;

  sc.tiers = sc.tiers.filter(t => t.id !== tierId);
  normalizeScenario(sc);
  refreshCard(scId);
  updateComparisonTable();
  saveState();
}

function syncOpenDetails() {
  document.querySelectorAll('.scenario-card').forEach(card => {
    const panel = card.querySelector('.detail-panel');
    const icon = card.querySelector('.toggle-icon');
    if (!panel || !icon) return;

    if (panel.classList.contains('open')) {
      panel.style.maxHeight = panel.scrollHeight + 'px';
      icon.classList.add('open');
    } else {
      panel.style.maxHeight = '0px';
      icon.classList.remove('open');
    }
  });
}

function toggleDetail(btn) {
  const card = btn.closest('.scenario-card');
  if (!card) return;

  const scId = Number(card.dataset.scId);
  const sc = scenarios.find(s => s.id === scId);
  if (!sc) return;

  const panel = card.querySelector('.detail-panel');
  const icon = card.querySelector('.toggle-icon');
  if (!panel || !icon) return;

  const isOpen = panel.classList.toggle('open');
  sc.detailOpen = isOpen;
  icon.classList.toggle('open', isOpen);
  panel.style.maxHeight = isOpen ? panel.scrollHeight + 'px' : '0px';
  saveState();
}

function buildCardHTML(sc) {
  const res = calculateScenario(sc);
  const isNeg = res.netProfit < 0;

  const tiersHTML = sc.tiers.map((tier, i) => {
    const firstEditable = i === 0;
    const fromVal = tier.from;
    const toVal = tier.to === null ? '' : tier.to;

    return `
      <div class="tier-row" data-tier-id="${tier.id}">
        <div class="tier-num">${i + 1}</div>

        <div class="tier-col-group">
          <div class="tier-col tier-col-from">
            <span class="tier-col-label">${firstEditable ? 'Başlangıç' : 'Başlangıç (kilitli)'}</span>
            <input
              class="tier-input"
              type="number"
              min="0"
              step="100"
              value="${fromVal}"
              ${firstEditable ? '' : 'readonly'}
              ${firstEditable ? `oninput="updateTierField(${sc.id}, ${tier.id}, 'from', this.value === '' ? 0 : parseFloat(this.value))"` : ''}
              onblur="commitScenario(${sc.id})"
              onchange="commitScenario(${sc.id})"
            />
          </div>

          <div class="tier-col tier-col-to">
            <span class="tier-col-label">Bitiş</span>
            <input
              class="tier-input"
              type="number"
              min="0"
              step="100"
              value="${toVal}"
              placeholder="∞"
              oninput="updateTierField(${sc.id}, ${tier.id}, 'to', this.value === '' ? null : parseFloat(this.value))"
              onblur="commitScenario(${sc.id})"
              onchange="commitScenario(${sc.id})"
            />
          </div>
        </div>

        <div class="tier-col tier-col-rate">
          <span class="tier-col-label">İndirim Oranı</span>
          <div class="slider-input-row">
            <div class="slider-wrap">
              <input
                type="range"
                min="0"
                max="60"
                step="0.5"
                value="${tier.rate}"
                oninput="updateTierField(${sc.id}, ${tier.id}, 'rate', parseFloat(this.value) || 0); this.parentElement.nextElementSibling.value = this.value"
                onchange="commitScenario(${sc.id})"
              />
            </div>
            <input
              type="number"
              class="tier-input"
              style="width: 80px !important"
              min="0"
              max="60"
              step="0.5"
              value="${tier.rate}"
              oninput="updateTierField(${sc.id}, ${tier.id}, 'rate', parseFloat(this.value) || 0); this.previousElementSibling.firstElementChild.value = this.value"
              onblur="commitScenario(${sc.id})"
              onchange="commitScenario(${sc.id})"
            />
          </div>
        </div>

        <div class="tier-actions">
          ${
            sc.tiers.length > 1
              ? `<button class="btn btn-danger btn-sm compact-btn" onclick="deleteTier(${sc.id}, ${tier.id})" title="Baremi Sil">✕</button>`
              : ''
          }
        </div>
      </div>
    `;
  }).join('');

  const detailRows = res.tierDetails
    .filter(td => td.slab > 0)
    .map(td => {
      const from = fmtTL(td.from);
      const to = td.to === Infinity ? '∞' : fmtTL(td.to);
      return `
        <tr>
          <td>Barem ${td.num} (${from} – ${to})</td>
          <td>${fmtTL(td.slab)}</td>
          <td>${fmtPct(td.rate)}</td>
          <td style="color: #e8edf5">${fmtTL(td.tierDiscount)}</td>
        </tr>
      `;
    }).join('');

  const lp = res.listPrice || 1;
  const basePct = clamp((res.baseCost / lp) * 100, 0, 100).toFixed(1);
  const discPct = clamp((res.discount / lp) * 100, 0, 100).toFixed(1);
  const profitPct = clamp((Math.max(0, res.netProfit) / lp) * 100, 0, 100).toFixed(1);

  const barRows = res.tierDetails
    .filter(td => td.slab > 0)
    .map((td, i) => {
      const discSeg = clamp((td.tierDiscount / lp) * 100, 0, 100).toFixed(1);
      const netSeg = clamp(((td.slab - td.tierDiscount) / lp) * 100, 0, 100).toFixed(1);
      return `
        <div class="bar-row">
          <div class="bar-label">Barem ${td.num}</div>
          <div class="bar-track">
            <div class="bar-seg bar-seg-discount" style="width:${discSeg}%" data-pct="${discSeg}%"></div>
            <div class="bar-seg" style="width:${netSeg}%; background:${TIER_COLORS[i % TIER_COLORS.length]}" data-pct="${netSeg}%"></div>
          </div>
        </div>
      `;
    }).join('') + `
      <div class="bar-row" style="margin-top:6px; padding-top:8px; border-top:1px solid rgba(255,255,255,.06)">
        <div class="bar-label" style="font-weight:800; color:#e5eaf1">Toplam</div>
        <div class="bar-track">
          <div class="bar-seg bar-seg-base" style="width:${basePct}%" data-pct="${basePct}%"></div>
          <div class="bar-seg bar-seg-discount" style="width:${discPct}%" data-pct="${discPct}%"></div>
          <div class="bar-seg bar-seg-profit" style="width:${profitPct}%" data-pct="${profitPct}%"></div>
        </div>
      </div>
    `;

  return `
    <div class="card-header">
      <div class="card-header-left">
        <span class="card-num-badge">#${sc.id}</span>
        <input
          class="card-title-input"
          value="${escapeHtml(sc.name)}"
          oninput="updateScenarioField(${sc.id}, 'name', this.value)"
          onblur="commitScenario(${sc.id})"
          onchange="commitScenario(${sc.id})"
          title="Senaryo adını düzenle"
        />
      </div>

      <div class="card-actions">
        <button class="btn btn-sm" onclick="copyScenario(${sc.id})">⧉ Kopyala</button>
        ${
          scenarios.length > 1
            ? `<button class="btn btn-danger btn-sm" onclick="deleteScenario(${sc.id})">✕ Sil</button>`
            : ''
        }
      </div>
    </div>

    <div class="card-content">
      <div class="card-left">
        <div class="section-box">
          <div class="input-group">
            <div class="input-label-row">
              <label class="input-label">Ürün Liste Fiyatı</label>
              <span class="input-hint">TL bazında giriş</span>
            </div>
            <div class="slider-input-row">
              <div class="slider-wrap">
                <input
                  type="range"
                  min="0"
                  max="250000"
                  step="100"
                  value="${res.listPrice}"
                  id="slider-price-${sc.id}"
                  oninput="updateScenarioField(${sc.id}, 'listPrice', parseFloat(this.value) || 0); document.getElementById('inp-price-${sc.id}').value = this.value"
                  onchange="commitScenario(${sc.id})"
                />
              </div>
              <input
                type="number"
                class="wide-input"
                id="inp-price-${sc.id}"
                min="0"
                max="250000"
                step="100"
                value="${res.listPrice}"
                oninput="updateScenarioField(${sc.id}, 'listPrice', parseFloat(this.value) || 0); document.getElementById('slider-price-${sc.id}').value = this.value"
                onblur="commitScenario(${sc.id})"
                onchange="commitScenario(${sc.id})"
              />
            </div>
          </div>
        </div>

        <div class="section-box" style="margin-top:14px">
          <div class="input-group">
            <div class="input-label-row">
              <label class="input-label">Başlangıç Kar Oranı</label>
              <span class="input-hint">Ürünün indirim öncesi marjı</span>
            </div>
            <div class="slider-input-row">
              <div class="slider-wrap">
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="0.5"
                  value="${res.marginPct}"
                  id="slider-margin-${sc.id}"
                  oninput="updateScenarioField(${sc.id}, 'marginPct', parseFloat(this.value) || 0); document.getElementById('inp-margin-${sc.id}').value = this.value"
                  onchange="commitScenario(${sc.id})"
                />
              </div>
              <input
                type="number"
                id="inp-margin-${sc.id}"
                min="0"
                max="100"
                step="0.5"
                value="${res.marginPct}"
                oninput="updateScenarioField(${sc.id}, 'marginPct', parseFloat(this.value) || 0); document.getElementById('slider-margin-${sc.id}').value = this.value"
                onblur="commitScenario(${sc.id})"
                onchange="commitScenario(${sc.id})"
              />
            </div>
          </div>
        </div>

        <div class="section-box" style="margin-top:14px">
          <div class="tiers-section">
            <div class="tiers-header">
              <span class="tiers-label">İndirim Baremleri</span>
              <button class="btn btn-info btn-sm" onclick="addTier(${sc.id})">＋ Barem Ekle</button>
            </div>
            <div class="tier-note">İlk baremin başlangıç değeri düzenlenebilir. Sonraki baremler bir önceki dilimin bitişine bağlanır.</div>
            <div style="display:flex; flex-direction:column; gap:10px; margin-top:2px">
              ${tiersHTML}
            </div>
          </div>
        </div>
      </div>

      <div class="card-right">
        <div class="section-box">
          <div class="mini-grid">
            <div class="output-item">
              <span class="output-label">Baz Maliyet</span>
              <span class="output-val">${fmtTL(res.baseCost)}</span>
            </div>
            <div class="output-item">
              <span class="output-label">Toplam İndirim</span>
              <span class="output-val">${fmtTL(res.discount)}</span>
            </div>
            <div class="output-item">
              <span class="output-label">Efektif İndirim Oranı</span>
              <span class="output-val">${fmtPct(res.effectivePct)}</span>
            </div>
            <div class="output-item">
              <span class="output-label">İndirimli Satış Fiyatı</span>
              <span class="output-val">${fmtTL(res.finalPrice)}</span>
            </div>
          </div>

          <div style="margin-top:10px" class="profit-box ${isNeg ? 'neg' : ''}">
            <div>
              <div class="output-label">${isNeg ? 'ZARAR' : 'NET KÂR'}</div>
              <div class="profit-meta">Yeni Kâr Marjı: ${fmtPct(res.newMargin)}</div>
            </div>
            <div class="output-val">${fmtTL(res.netProfit)}</div>
          </div>
        </div>

        <div style="margin-top:14px">
          <button class="detail-toggle" onclick="toggleDetail(this)">
            <em class="toggle-icon ${sc.detailOpen ? 'open' : ''}">▼</em>
            Hesaplama Detay Tablosu
          </button>
          <div class="detail-panel ${sc.detailOpen ? 'open' : ''}">
            <div class="detail-table-wrap">
              <table class="detail-table">
                <thead>
                  <tr>
                    <th>Barem</th>
                    <th>Uygulanan Miktar</th>
                    <th>Oran</th>
                    <th>İndirim Tutarı</th>
                  </tr>
                </thead>
                <tbody>
                  ${
                    detailRows || `<tr><td colspan="4" style="text-align:center; color: var(--muted)">Veri yok</td></tr>`
                  }
                  <tr>
                    <td style="font-weight:800; color:#eef3f7">Toplam</td>
                    <td>${fmtTL(res.listPrice)}</td>
                    <td>${fmtPct(res.effectivePct)}</td>
                    <td>${fmtTL(res.discount)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div class="chart-section">
          <div class="chart-section-title">Fiyat Dilim Grafiği</div>
          <div class="stacked-bar-wrap">
            ${barRows}
          </div>
          <div class="chart-legend">
            <span><span class="legend-dot" style="background: rgba(255,255,255,.55)"></span>Maliyet</span>
            <span><span class="legend-dot" style="background: rgba(167,139,250,.72)"></span>İndirim</span>
            <span><span class="legend-dot" style="background: rgba(74,222,128,.72)"></span>Kâr</span>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderAllCards() {
  const wrapper = document.getElementById('scenarios-wrapper');
  wrapper.innerHTML = scenarios.map(sc => {
    return `<article class="scenario-card ${calculateScenario(sc).netProfit < 0 ? 'negative-profit' : ''}" data-sc-id="${sc.id}">
      ${buildCardHTML(sc)}
    </article>`;
  }).join('');
  syncOpenDetails();
  updateComparisonTable();
  updateAddButton();
}

function refreshCard(id) {
  const sc = scenarios.find(s => s.id === id);
  if (!sc) return;

  const card = document.querySelector(`.scenario-card[data-sc-id="${id}"]`);
  if (!card) return;

  card.className = `scenario-card ${calculateScenario(sc).netProfit < 0 ? 'negative-profit' : ''}`;
  card.innerHTML = buildCardHTML(sc);
  syncOpenDetails();
}

function updateComparisonTable() {
  const headRow = document.getElementById('comp-head-row');
  const body = document.getElementById('comp-body');

  const results = scenarios.map(sc => ({ sc, res: calculateScenario(sc) }));

  headRow.innerHTML = `<th>Metrik</th>` + results.map(r => `<th>${escapeHtml(r.sc.name)}</th>`).join('');

  const METRICS = [
    { key: 'listPrice',    label: 'Liste Fiyatı',           fmt: fmtTL,  profit: false },
    { key: 'baseCost',     label: 'Baz Maliyet',            fmt: fmtTL,  profit: false },
    { key: 'discount',     label: 'Toplam İndirim',         fmt: fmtTL,  profit: false },
    { key: 'effectivePct', label: 'Efektif İndirim Oranı',  fmt: fmtPct, profit: false },
    { key: 'finalPrice',   label: 'İndirimli Satış Fiyatı', fmt: fmtTL,  profit: false },
    { key: 'netProfit',    label: 'Net Kâr (TL)',           fmt: fmtTL,  profit: true  },
    { key: 'newMargin',    label: 'Yeni Kâr Marjı',         fmt: fmtPct, profit: false },
  ];

  body.innerHTML = METRICS.map(metric => {
    const cells = results.map(r => {
      const val = r.res[metric.key];
      if (metric.profit) {
        const cls = val >= 0 ? 'profit-cell-pos' : 'profit-cell-neg';
        return `<td class="${cls}">${metric.fmt(val)}</td>`;
      }
      return `<td>${metric.fmt(val)}</td>`;
    }).join('');
    return `<tr class="${metric.profit ? 'profit-row' : ''}"><td>${metric.label}</td>${cells}</tr>`;
  }).join('');
}

function exportPDF() {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(230, 234, 241);
  doc.text('Marjinal Indirim & Karlilik Simulatoru', 14, 17);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(135, 145, 160);
  doc.text('Olusturulma: ' + new Date().toLocaleString('tr-TR'), 14, 24);

  const results = scenarios.map(sc => ({ sc, res: calculateScenario(sc) }));

  const METRICS = [
    { key: 'listPrice',    label: 'Liste Fiyatı',           fmt: fmtTL,  profit: false },
    { key: 'baseCost',     label: 'Baz Maliyet',            fmt: fmtTL,  profit: false },
    { key: 'discount',     label: 'Toplam İndirim',         fmt: fmtTL,  profit: false },
    { key: 'effectivePct', label: 'Efektif İndirim Oranı',  fmt: fmtPct, profit: false },
    { key: 'finalPrice',   label: 'İndirimli Satış Fiyatı', fmt: fmtTL,  profit: false },
    { key: 'netProfit',    label: 'Net Kâr (TL)',           fmt: fmtTL,  profit: true  },
    { key: 'newMargin',    label: 'Yeni Kâr Marjı',         fmt: fmtPct, profit: false },
  ];

  const pageWidth = 297;
  const leftMargin = 12;
  const top = 34;
  const labelWidth = 64;
  const tableWidth = pageWidth - leftMargin * 2;
  const colWidth = Math.max(30, (tableWidth - labelWidth) / Math.max(1, results.length));

  let y = top;

  doc.setFillColor(26, 29, 36);
  doc.rect(leftMargin, y - 5, tableWidth, 9, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(227, 232, 239);
  doc.text('Metrik', leftMargin + 2, y);
  results.forEach((r, i) => {
    doc.text(r.sc.name, leftMargin + labelWidth + (i * colWidth) + 2, y, { maxWidth: colWidth - 4 });
  });
  y += 8;

  METRICS.forEach((metric, mi) => {
    if (y > 186) {
      doc.addPage();
      y = 18;
    }

    doc.setFillColor(mi % 2 === 0 ? 14 : 18, mi % 2 === 0 ? 18 : 22, mi % 2 === 0 ? 24 : 28);
    doc.rect(leftMargin, y - 4, tableWidth, 7, 'F');

    doc.setFont('helvetica', metric.profit ? 'bold' : 'normal');
    doc.setFontSize(8);
    doc.setTextColor(216, 226, 241);
    doc.text(metric.label, leftMargin + 2, y);

    results.forEach((r, i) => {
      const val = r.res[metric.key];
      if (metric.profit) {
        if (val >= 0) doc.setTextColor(74, 222, 128);
        else doc.setTextColor(242, 166, 166);
      } else {
        doc.setTextColor(236, 243, 255);
      }
      doc.text(metric.fmt(val), leftMargin + labelWidth + (i * colWidth) + 2, y, { maxWidth: colWidth - 4 });
    });

    y += 7;
  });

  doc.save('marjinal-indirim-simulatoru.pdf');
  showToast('PDF indirildi.');
}

document.getElementById('btn-info-modal').addEventListener('click', () => {
  const modal = document.getElementById('info-modal');
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
});

document.getElementById('btn-close-info').addEventListener('click', () => {
  const modal = document.getElementById('info-modal');
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
});

document.getElementById('info-modal').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) {
    e.currentTarget.classList.remove('open');
    e.currentTarget.setAttribute('aria-hidden', 'true');
  }
});

document.getElementById('btn-add-scenario').addEventListener('click', () => addScenario());
document.getElementById('btn-export-pdf').addEventListener('click', exportPDF);

function init() {
  const loaded = loadState();
  if (!loaded) {
    scenarios = [createScenario()];
    saveState();
  }
  scenarios = scenarios.map(sc => normalizeScenario(sc));
  updateAddButton();
  renderAllCards();
  updateComparisonTable();
}

init();