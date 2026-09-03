(() => {
  const API = 'http://localhost:8000';
  const STYLE_ID = 'orca-past-trends-scatter-styles';
  const ROOT_ID = 'orca-past-trends-scatter';

  function addStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = `
      #${ROOT_ID}{margin-top:14px}
      #${ROOT_ID} .pts-note{font-size:11px;color:#94a3b8;line-height:1.55;margin:-4px 0 12px}
      #${ROOT_ID} .pts-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}
      #${ROOT_ID} .pts-card{background:#0b1220;border:1px solid #1e293b;border-radius:15px;padding:17px;box-shadow:0 12px 35px rgba(0,0,0,.16)}
      #${ROOT_ID} h3{font-size:14px;margin:0 0 5px;color:#cbd5e1}
      #${ROOT_ID} .pts-sub{font-size:10px;color:#64748b;margin-bottom:9px}
      #${ROOT_ID} .pts-scroll{overflow:auto}
      #${ROOT_ID} svg{display:block;width:100%;min-width:520px;height:auto}
      #${ROOT_ID} .pts-gridline{stroke:#1e293b;stroke-width:1}
      #${ROOT_ID} .pts-axis{stroke:#475569;stroke-width:1}
      #${ROOT_ID} .pts-tick{fill:#64748b;font-size:10px}
      #${ROOT_ID} .pts-point{stroke:#020617;stroke-width:1.2}
      #${ROOT_ID} .pts-fit{fill:none;stroke:#94a3b8;stroke-width:1.5;stroke-dasharray:5 4}
      #${ROOT_ID} .pts-r{font-size:12px;color:#e2e8f0;font-weight:700;margin-top:7px}
      #${ROOT_ID} .pts-r span{color:#94a3b8;font-weight:500}
      #${ROOT_ID} .pts-empty{padding:35px 10px;text-align:center;color:#64748b;font-size:12px}
      @media(max-width:800px){#${ROOT_ID} .pts-grid{grid-template-columns:1fr}}
    `;
    document.head.appendChild(s);
  }

  const esc = s => String(s ?? '').replace(/[&<>\"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[c]));

  function pearson(rows, xKey, yKey) {
    const p = rows.map(r => [Number(r[xKey]), Number(r[yKey])]).filter(([x,y]) => Number.isFinite(x) && Number.isFinite(y));
    if (p.length < 3) return { r: null, n: p.length };
    const xm = p.reduce((a,v) => a + v[0], 0) / p.length;
    const ym = p.reduce((a,v) => a + v[1], 0) / p.length;
    let num = 0, dx = 0, dy = 0;
    p.forEach(([x,y]) => { const a=x-xm,b=y-ym; num+=a*b; dx+=a*a; dy+=b*b; });
    return { r: dx && dy ? num / Math.sqrt(dx*dy) : null, n: p.length };
  }

  function regression(rows, xKey, yKey) {
    const p = rows.map(r => [Number(r[xKey]), Number(r[yKey])]).filter(([x,y]) => Number.isFinite(x) && Number.isFinite(y));
    if (p.length < 2) return null;
    const xm = p.reduce((a,v)=>a+v[0],0)/p.length;
    const ym = p.reduce((a,v)=>a+v[1],0)/p.length;
    let den=0,num=0;
    p.forEach(([x,y])=>{den+=(x-xm)*(x-xm);num+=(x-xm)*(y-ym)});
    const m=den?num/den:0, b=ym-m*xm;
    return {m,b,minX:Math.min(...p.map(v=>v[0])),maxX:Math.max(...p.map(v=>v[0]))};
  }

  function scatter(rows, xKey, yKey, xLabel, yLabel, title, unit, corr) {
    const p = rows.map(r => ({x:Number(r[xKey]), y:Number(r[yKey]), year:r.Year})).filter(v=>Number.isFinite(v.x)&&Number.isFinite(v.y));
    if (!p.length) return '<div class="pts-empty">No matching annual data available.</div>';
    const W=760,H=330,L=72,R=22,T=24,B=55;
    const minX=Math.min(...p.map(v=>v.x)), maxX=Math.max(...p.map(v=>v.x));
    const minY=Math.min(...p.map(v=>v.y)), maxY=Math.max(...p.map(v=>v.y));
    const padX=(maxX-minX)||1, padY=(maxY-minY)||1;
    const x0=minX-padX*.08, x1=maxX+padX*.08, y0=minY-padY*.12, y1=maxY+padY*.12;
    const sx=x=>(L+(x-x0)*(W-L-R)/(x1-x0));
    const sy=y=>(T+(y1-y)*(H-T-B)/(y1-y0));
    const grid=Array.from({length:5},(_,i)=>{
      const y=y0+(y1-y0)*i/4, yy=sy(y);
      return `<line class="pts-gridline" x1="${L}" y1="${yy}" x2="${W-R}" y2="${yy}"/><text class="pts-tick" x="${L-8}" y="${yy+4}" text-anchor="end">${y.toFixed(y<10?2:1)}</text>`;
    }).join('');
    const xTicks=Array.from({length:5},(_,i)=>{
      const x=x0+(x1-x0)*i/4, xx=sx(x);
      return `<line class="pts-gridline" x1="${xx}" y1="${T}" x2="${xx}" y2="${H-B}"/><text class="pts-tick" x="${xx}" y="${H-35}" text-anchor="middle">${x.toFixed(x<10?2:1)}</text>`;
    }).join('');
    const fit=regression(rows,xKey,yKey);
    const fitLine=fit?`<line class="pts-fit" x1="${sx(fit.minX)}" y1="${sy(fit.m*fit.minX+fit.b)}" x2="${sx(fit.maxX)}" y2="${sy(fit.m*fit.maxX+fit.b)}"/>`:'';
    const points=p.map(v=>`<circle class="pts-point" cx="${sx(v.x)}" cy="${sy(v.y)}" r="5" fill="#3b82f6"><title>${esc(String(v.year))}: ${xLabel} ${v.x.toFixed(3)} ${unit ? unit.split('/')[0] : ''}; ${yLabel} ${v.y.toFixed(1)} tonnes</title></circle>`).join('');
    return `<div class="pts-sub">Each point is one annual observation from 2007–2012. Dashed line = simple linear fit.</div><div class="pts-scroll"><svg viewBox="0 0 ${W} ${H}" aria-label="${esc(title)}"><g>${grid}${xTicks}</g><line class="pts-axis" x1="${L}" y1="${T}" x2="${L}" y2="${H-B}"/><line class="pts-axis" x1="${L}" y1="${H-B}" x2="${W-R}" y2="${H-B}"/>${fitLine}${points}<text class="pts-tick" x="${(L+W-R)/2}" y="${H-8}" text-anchor="middle">${esc(xLabel)}</text><text class="pts-tick" x="16" y="${(T+H-B)/2}" text-anchor="middle" transform="rotate(-90 16 ${(T+H-B)/2})">${esc(yLabel)}</text></svg></div><div class="pts-r">Pearson r: ${corr.r==null?'—':corr.r.toFixed(2)} <span>· n = ${corr.n}</span></div>`;
  }

  async function render() {
    const tc=document.getElementById('trend-content');
    const rs=document.getElementById('mp-region');
    const ss=document.getElementById('mp-species');
    if(!tc || !rs || !ss) return;
    const existing=document.getElementById(ROOT_ID);
    if(existing) existing.remove();
    try{
      const qs=`state=${encodeURIComponent(rs.value)}${ss.value?`&species=${encodeURIComponent(ss.value)}`:''}`;
      const a=await fetch(`${API}/api/marine-productivity/analysis?${qs}`).then(r=>{if(!r.ok)throw new Error('analysis unavailable');return r.json()});
      const rows=(a.annual||[]).filter(r=>Number.isFinite(Number(r.catch)) && Number.isFinite(Number(r.sst)) && Number.isFinite(Number(r.chlorophyll)));
      const wrap=document.createElement('section');wrap.id=ROOT_ID;
      const cs=pearson(rows,'sst','catch'),cc=pearson(rows,'chlorophyll','catch');
      wrap.innerHTML=`<div class="pts-note">Catch is matched to the same annual coastal-region observation used by the existing Past Trends analysis. The plots are exploratory correlations, not causal relationships.</div><div class="pts-grid"><div class="pts-card"><h3>Chlorophyll-a vs Fish Catch</h3>${scatter(rows,'chlorophyll','catch','Chlorophyll-a (mg/m³)','Fish catch (tonnes)','Chlorophyll-a vs fish catch','mg/m³',cc)}</div><div class="pts-card"><h3>SST vs Fish Catch</h3>${scatter(rows,'sst','catch','SST (°C)','Fish catch (tonnes)','SST vs fish catch','°C',cs)}</div></div>`;
      tc.appendChild(wrap);
    }catch(e){
      const wrap=document.createElement('section');wrap.id=ROOT_ID;
      wrap.innerHTML='<div class="pts-card"><div class="pts-empty">Unable to load correlation plots.</div></div>';
      tc.appendChild(wrap);
    }
  }

  function boot(){
    addStyles();
    const observer=new MutationObserver(()=>{
      const tc=document.getElementById('trend-content');
      if(!tc || tc.dataset.scatterBoot==='1') return;
      tc.dataset.scatterBoot='1';
      setTimeout(render,80);
      const rs=document.getElementById('mp-region'), ss=document.getElementById('mp-species');
      rs?.addEventListener('change',()=>setTimeout(render,120));
      ss?.addEventListener('change',()=>setTimeout(render,120));
      document.getElementById('mp-run')?.addEventListener('click',()=>setTimeout(render,180));
    });
    observer.observe(document.body,{childList:true,subtree:true});
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',boot); else boot();
})();
