(() => {
  const EXPLANATION_ID = 'pfz-advisory-basis';
  const STYLE_ID = 'pfz-advisory-basis-styles';

  function addStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${EXPLANATION_ID} { margin-top: 14px; }
      #${EXPLANATION_ID} .basis-title { display:flex; align-items:center; justify-content:space-between; gap:10px; margin-bottom:12px; }
      #${EXPLANATION_ID} .basis-title h3 { margin:0; font-size:14px; color:#cbd5e1; }
      #${EXPLANATION_ID} .basis-badge { font-size:9px; color:#6ee7b7; border:1px solid #065f46; border-radius:999px; padding:3px 7px; white-space:nowrap; }
      #${EXPLANATION_ID} .basis-intro { font-size:11px; line-height:1.6; color:#94a3b8; margin:0 0 12px; }
      #${EXPLANATION_ID} .basis-grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:8px; }
      #${EXPLANATION_ID} .basis-item { border:1px solid #1e293b; border-radius:10px; background:#070d18; padding:10px; }
      #${EXPLANATION_ID} .basis-weight { font-size:16px; font-weight:800; color:#f1f5f9; }
      #${EXPLANATION_ID} .basis-name { font-size:10px; color:#cbd5e1; margin-top:2px; }
      #${EXPLANATION_ID} .basis-desc { font-size:9px; line-height:1.45; color:#64748b; margin-top:4px; }
      #${EXPLANATION_ID} .basis-note { margin-top:11px; padding:9px 10px; border:1px solid #1e293b; border-radius:9px; background:#020617; color:#64748b; font-size:9px; line-height:1.55; }
      #${EXPLANATION_ID} .basis-note b { color:#94a3b8; }
      @media(max-width:800px){ #${EXPLANATION_ID} .basis-grid{grid-template-columns:1fr 1fr;} }
      @media(max-width:520px){ #${EXPLANATION_ID} .basis-grid{grid-template-columns:1fr;} }
    `;
    document.head.appendChild(style);
  }

  function makePanel() {
    const panel = document.createElement('section');
    panel.id = EXPLANATION_ID;
    panel.className = 'mp-card';
    panel.innerHTML = `
      <div class="basis-title">
        <h3>How the PFZ advisory is generated</h3>
        <span class="basis-badge">WEIGHTED DECISION SCORE</span>
      </div>
      <p class="basis-intro">
        Each existing PFZ advisory is scored using its distance from your location, advisory freshness, current marine conditions at the candidate PFZ, and the historical environmental profile of its coastal region. The candidate with the highest final score is ranked first.
      </p>
      <div class="basis-grid">
        <div class="basis-item"><div class="basis-weight">20%</div><div class="basis-name">Proximity</div><div class="basis-desc">Closer advisory locations receive a higher proximity score.</div></div>
        <div class="basis-item"><div class="basis-weight">10%</div><div class="basis-name">Advisory freshness</div><div class="basis-desc">More recent/current PFZ advisories receive a higher score.</div></div>
        <div class="basis-item"><div class="basis-weight">20%</div><div class="basis-name">Live SST</div><div class="basis-desc">Current SST is fetched at each candidate PFZ coordinate and converted to a suitability score.</div></div>
        <div class="basis-item"><div class="basis-weight">20%</div><div class="basis-name">Live chlorophyll-a</div><div class="basis-desc">Current chlorophyll is fetched at each candidate PFZ coordinate and normalized as a productivity score.</div></div>
        <div class="basis-item"><div class="basis-weight">15%</div><div class="basis-name">Historical SST</div><div class="basis-desc">Uses the candidate coastal region's 2007–2012 SST pattern as historical context.</div></div>
        <div class="basis-item"><div class="basis-weight">15%</div><div class="basis-name">Historical chlorophyll</div><div class="basis-desc">Uses the candidate coastal region's 2007–2012 chlorophyll pattern as historical productivity context.</div></div>
      </div>
      <div class="basis-note">
        <b>Important:</b> the PFZ Finder is a weighted scoring/ranking system, not a trained machine-learning prediction model. Live SST and chlorophyll are part of the score at the candidate location itself. The historical 2007–2012 SST/chlorophyll series in this repository is synthetic and is used as historical context.
      </div>
    `;
    return panel;
  }

  function ensurePanel() {
    const layout = document.querySelector('#orca-productivity-enhanced .pfz-layout');
    if (!layout) return;
    const existing = document.getElementById(EXPLANATION_ID);
    if (existing && existing.previousElementSibling === layout) return;
    if (existing) existing.remove();
    layout.insertAdjacentElement('afterend', makePanel());
  }

  addStyles();
  const observer = new MutationObserver(() => ensurePanel());
  observer.observe(document.body, { childList: true, subtree: true });
  ensurePanel();
})();
