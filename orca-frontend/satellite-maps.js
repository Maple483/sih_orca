(() => {
  const WMS_URL = 'https://gibs.earthdata.nasa.gov/wms/epsg3857/best/wms.cgi';
  const INDIA_MARINE_BOUNDS = [[4, 64], [26, 96]];
  const INDIA_MARINE_CENTER = [15, 80];
  const HOLDER_ID = 'orca-current-satellite-maps';
  let maps = [];
  let stylesAdded = false;

  function addStyles() {
    if (stylesAdded) return;
    const style = document.createElement('style');
    style.textContent = `
      #${HOLDER_ID}{display:grid;grid-template-columns:1fr 1fr;gap:18px}
      #${HOLDER_ID} .sat-card{min-width:0}
      #${HOLDER_ID} .sat-map{height:390px;border-radius:10px;overflow:hidden;border:1px solid #334155;background:#020617}
      #${HOLDER_ID} .sat-meta{margin-top:8px;font-size:10px;color:#64748b;line-height:1.5}
      #${HOLDER_ID} .leaflet-container{font:11px ui-sans-serif,system-ui,sans-serif}
      #${HOLDER_ID} .sat-title{display:flex;align-items:center;justify-content:space-between;gap:8px}
      #${HOLDER_ID} .sat-current{font-size:9px;color:#34d399;border:1px solid #065f46;border-radius:999px;padding:3px 7px;font-weight:700;white-space:nowrap}
      #${HOLDER_ID} .sat-legend{position:absolute;left:10px;bottom:10px;z-index:1000;min-width:230px;padding:8px 9px;border:1px solid rgba(51,65,85,.95);border-radius:8px;background:rgba(2,6,23,.9);box-shadow:0 6px 18px rgba(0,0,0,.3);color:#e2e8f0}
      #${HOLDER_ID} .sat-legend-title{font-size:10px;font-weight:700;margin-bottom:6px}
      #${HOLDER_ID} .sat-gradient{height:10px;border-radius:999px;border:1px solid rgba(255,255,255,.2)}
      #${HOLDER_ID} .sst-gradient{background:linear-gradient(90deg,#2b001a 0%,#4b0030 14%,#65124d 28%,#3d47a5 42%,#087fd8 55%,#00bfae 68%,#8bd646 80%,#f5e942 91%,#ff8c24 100%)}
      #${HOLDER_ID} .chl-gradient{background:linear-gradient(90deg,#1b1464 0%,#185ac6 18%,#14b8a6 38%,#5ccf73 55%,#d8df42 72%,#f5a623 86%,#d7191c 100%)}
      #${HOLDER_ID} .sat-legend-scale{display:flex;justify-content:space-between;gap:8px;margin-top:4px;font-size:9px;color:#cbd5e1}
      #${HOLDER_ID} .leaflet-control-attribution{font-size:8px}
      @media(max-width:700px){#${HOLDER_ID}{grid-template-columns:1fr}#${HOLDER_ID} .sat-map{height:340px}}
    `;
    document.head.appendChild(style);
    stylesAdded = true;
  }

  function destroyMaps() {
    maps.forEach(map => {
      try { map.remove(); } catch (_) {}
    });
    maps = [];
  }

  function addLegend(map, type) {
    const control = window.L.control({ position: 'bottomleft' });
    control.onAdd = () => {
      const div = window.L.DomUtil.create('div', 'sat-legend');
      if (type === 'sst') {
        div.innerHTML = `
          <div class="sat-legend-title">Sea Surface Temperature (°C)</div>
          <div class="sat-gradient sst-gradient"></div>
          <div class="sat-legend-scale"><span>&lt; 0</span><span>8</span><span>16</span><span>24</span><span>≥ 32</span></div>
        `;
      } else {
        div.innerHTML = `
          <div class="sat-legend-title">Chlorophyll-a (mg/m³)</div>
          <div class="sat-gradient chl-gradient"></div>
          <div class="sat-legend-scale"><span>&lt; 0.01</span><span>0.1</span><span>1</span><span>10</span><span>≥ 20</span></div>
        `;
      }
      window.L.DomEvent.disableClickPropagation(div);
      return div;
    };
    control.addTo(map);
  }

  function makeMap(containerId, layerName, type) {
    const map = window.L.map(containerId, {
      zoomControl: true,
      scrollWheelZoom: false,
      minZoom: 4,
      maxZoom: 8,
      maxBounds: INDIA_MARINE_BOUNDS,
      maxBoundsViscosity: 1.0,
      preferCanvas: true,
    }).setView(INDIA_MARINE_CENTER, 5);

    window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 18,
    }).addTo(map);

    window.L.tileLayer.wms(WMS_URL, {
      layers: layerName,
      styles: '',
      format: 'image/png',
      transparent: true,
      version: '1.3.0',
      opacity: 0.88,
      attribution: 'NASA GIBS',
    }).addTo(map);

    window.L.rectangle(INDIA_MARINE_BOUNDS, {
      color: '#38bdf8',
      weight: 1,
      fill: false,
      dashArray: '5,6',
      opacity: 0.55,
    }).addTo(map);

    window.L.control.scale({ imperial: false }).addTo(map);
    addLegend(map, type);
    return map;
  }

  function ensureMaps() {
    addStyles();
    const root = document.getElementById('orca-productivity-enhanced');
    const content = root?.querySelector('#pe-content');
    if (!root || !content || !window.L) {
      destroyMaps();
      return;
    }

    let holder = content.querySelector(`#${HOLDER_ID}`);
    if (!holder) {
      destroyMaps();
      holder = document.createElement('div');
      holder.id = HOLDER_ID;
      holder.innerHTML = `
        <section class="pe-card sat-card">
          <h3 class="sat-title"><span>Current Satellite SST — Indian Marine Waters</span><span class="sat-current">LIVE / BEST AVAILABLE</span></h3>
          <div id="orca-satellite-sst-map" class="sat-map"></div>
          <div class="sat-meta">NASA GIBS · GHRSST Level 4 MUR Sea Surface Temperature · Legend shown on map: 0–32 °C.</div>
        </section>
        <section class="pe-card sat-card">
          <h3 class="sat-title"><span>Current Satellite Chlorophyll-a — Indian Marine Waters</span><span class="sat-current">LIVE / BEST AVAILABLE</span></h3>
          <div id="orca-satellite-chl-map" class="sat-map"></div>
          <div class="sat-meta">NASA GIBS · NOAA-20 / VIIRS Chlorophyll-a · Legend shown on map: 0.01–20 mg/m³.</div>
        </section>
      `;
      content.appendChild(holder);
    }

    if (maps.length === 0 && holder.querySelector('#orca-satellite-sst-map') && holder.querySelector('#orca-satellite-chl-map')) {
      maps = [
        makeMap('orca-satellite-sst-map', 'GHRSST_L4_MUR_Sea_Surface_Temperature', 'sst'),
        makeMap('orca-satellite-chl-map', 'VIIRS_NOAA20_Chlorophyll_a', 'chl'),
      ];
      requestAnimationFrame(() => maps.forEach(map => map.invalidateSize()));
    }
  }

  const observer = new MutationObserver(() => ensureMaps());
  observer.observe(document.body, { childList: true, subtree: true });
  window.addEventListener('resize', () => maps.forEach(map => map.invalidateSize()));
  ensureMaps();
})();