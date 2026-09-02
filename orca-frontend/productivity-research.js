(() => {
  const API = 'http://localhost:8000';
  const esc = s => String(s ?? '').replace(/[&<>\"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[c]));
  const fmt = n => n == null ? '—' : Number(n).toFixed(2);

  async function refresh(root) {
    const region = root.querySelector('#pe-region')?.value;
    const species = root.querySelector('#pe-species')?.value || '';
    const content = root.querySelector('#pe-content');
    if (!region || !content) return;
    try {
      const qs = `state=${encodeURIComponent(region)}${species ? `&species=${encodeURIComponent(species)}` : ''}`;
      const r = await fetch(`${API}/api/marine-productivity/research?${qs}`);
      if (!r.ok) return;
      const d = await r.json();
      let card = root.querySelector('#pe-research-card');
      if (!card) { card = document.createElement('section'); card.id = 'pe-research-card'; card.className = 'pe-card'; content.appendChild(card); }
      const c = d.correlation || {}, s = d.strongest_relationship, lag = d.lag_analysis || {}, ex = d.explanation || {};
      card.innerHTML = `<h3>Research Interpretation &amp; Lag Analysis</h3>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">
          <div style="border:1px solid #1e293b;border-radius:10px;padding:11px"><div style="font-size:10px;color:#64748b">Catch ↔ Chlorophyll</div><div style="font-size:24px;font-weight:800">${fmt(c.catch_vs_chlorophyll)}</div></div>
          <div style="border:1px solid #1e293b;border-radius:10px;padding:11px"><div style="font-size:10px;color:#64748b">Catch ↔ SST</div><div style="font-size:24px;font-weight:800">${fmt(c.catch_vs_sst)}</div></div>
        </div>
        <div style="border:1px solid #1e293b;border-radius:10px;padding:12px;margin-bottom:10px"><div style="font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:#64748b;margin-bottom:5px">Strongest relationship</div><div style="font-size:13px;color:#e2e8f0">${s ? `${esc(s.variable)} · r = ${fmt(s.r)}` : 'Insufficient data'}</div></div>
        <div style="border:1px solid #1e293b;border-radius:10px;padding:12px"><div style="font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:#64748b;margin-bottom:5px">Lag analysis</div><div style="font-size:12px;color:#cbd5e1">${esc(lag.reason || 'Monthly 0–3 month lag analysis is unavailable with annual catch observations.')}</div></div>
        <div style="margin-top:12px;font-size:12px;line-height:1.6;color:#cbd5e1"><b>AI interpretation</b><br>${esc(ex.text || 'No interpretation available.')}</div>
        <div style="margin-top:10px;padding:10px;border-radius:9px;background:#451a03;border:1px solid #92400e;color:#fbbf24;font-size:11px;line-height:1.5">⚠️ ${esc(ex.caution || 'Correlation does not prove causation.')}</div>`;
    } catch (_) {}
  }

  function attach(root) {
    if (root.dataset.researchAttached) return;
    root.dataset.researchAttached = '1';
    const refreshNow = () => { clearTimeout(root.__orcaResearchTimer); root.__orcaResearchTimer = setTimeout(() => refresh(root), 100); };
    root.querySelector('#pe-region')?.addEventListener('change', refreshNow);
    root.querySelector('#pe-species')?.addEventListener('change', refreshNow);
    root.querySelector('#pe-run')?.addEventListener('click', refreshNow);
    refreshNow();
  }

  const watch = new MutationObserver(() => {
    const root = document.getElementById('orca-productivity-enhanced');
    if (root) attach(root);
  });
  watch.observe(document.body, { childList: true });
})();
