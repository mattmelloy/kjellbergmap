// main.js - improved Leaflet map for Redlynch orthomosaic + basemap switcher
// - Fetches and parses redlynch/tilemapresource.xml for bounds and zooms
// - Supports adding more local tile layers easily via createLocalTileLayer()
// - Uses a transparent error tile to avoid ugly broken-tile visuals and console noise
// - Adds a small overlay opacity control when an overlay is active

const TRANSPARENT_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAAWgmWQ0AAAAASUVORK5CYII=';

// Helper to create a local tile layer with sane defaults
function createLocalTileLayer(pathTemplate, opts = {}) {
  const defaults = {
    tileSize: 256,
    maxZoom: 23,
    minZoom: 0,
    errorTileUrl: TRANSPARENT_PNG,
    tms: false,
    attribution: ''
  };
  const options = Object.assign({}, defaults, opts);
  return L.tileLayer(pathTemplate, options);
}

// Create popular basemaps
function createBaseLayers() {
  const openWebMap = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 23,
    attribution: '&copy; OpenStreetMap contributors'
  });

  const imagery = L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    {
      maxZoom: 23,
      attribution: 'Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics'
    }
  );

  const googleImagery = L.tileLayer('https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', {
    maxZoom: 23,
    attribution: 'Google Maps Imagery'
  });

  return { OpenWebMap: openWebMap, Imagery: imagery, GoogleImagery: googleImagery };
}

// Small UI control to adjust overlay opacity
const OpacityControl = L.Control.extend({
  options: { position: 'topright' },
  initialize: function (layer, opts) {
    L.Util.setOptions(this, opts);
    this.layer = layer;
  },
  onAdd: function () {
    const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control');
    container.style.padding = '6px';
    container.style.background = 'white';
    container.style.minWidth = '140px';
    container.style.boxSizing = 'border-box';

    const label = L.DomUtil.create('label', '', container);
    label.style.fontSize = '12px';
    label.style.display = 'block';
    label.style.marginBottom = '4px';
    label.textContent = 'Overlay opacity';

    const input = L.DomUtil.create('input', '', container);
    input.type = 'range';
    input.min = 0;
    input.max = 1;
    input.step = 0.05;
    input.value = this.layer.options.opacity ?? 1;

    L.DomEvent.disableClickPropagation(container);
    input.addEventListener('input', (e) => {
      const v = parseFloat(e.target.value);
      this.layer.setOpacity(v);
    });

    return container;
  }
});

// Main async initializer - reads tilemapresource.xml then creates the map
async function init() {
  let bounds;
  let minZoom = 0;
  let maxZoom = 23;

  // Attempt to load tilemapresource.xml for bounds/zoom info (try Kjellberg orthophoto first, then DSM)
  try {
    let xml = null;
    const tryPaths = [
      'Kjellberg-orthophoto_tiles/tilemapresource.xml',
      'Kjellberg-dsm_tiles/tilemapresource.xml'
    ];
    const parser = new DOMParser();
    for (const p of tryPaths) {
      try {
        const resp = await fetch(p);
        if (!resp.ok) throw new Error('Failed to fetch ' + p);
        const text = await resp.text();
        xml = parser.parseFromString(text, 'application/xml');
        console.log('Loaded tilemapresource.xml from', p);
        break;
      } catch (e) {
        // try next path
      }
    }

    if (!xml) throw new Error('No tilemapresource.xml found in Kjellberg directories');

    // Parse bounding box
    const bbox = xml.querySelector('BoundingBox');
    if (bbox) {
      const minx = parseFloat(bbox.getAttribute('minx'));
      const miny = parseFloat(bbox.getAttribute('miny'));
      const maxx = parseFloat(bbox.getAttribute('maxx'));
      const maxy = parseFloat(bbox.getAttribute('maxy'));
      // XML appears to contain lon/lat (minx=minLon, miny=minLat)
      const sw = L.latLng(miny, minx);
      const ne = L.latLng(maxy, maxx);
      bounds = L.latLngBounds(sw, ne);
    }

    // Parse TileSet orders to determine min/max zoom
    const tileSets = Array.from(xml.querySelectorAll('TileSet'));
    if (tileSets.length > 0) {
      const orders = tileSets.map(ts => parseInt(ts.getAttribute('order'), 10)).filter(n => !isNaN(n));
      if (orders.length > 0) {
        minZoom = Math.min(...orders);
        maxZoom = Math.max(...orders);
      }
    }
  } catch (err) {
    console.warn('Could not read tilemapresource.xml, falling back to defaults:', err.message);
    // Fallback bounds (small area near the tiles) - adjust if needed
    bounds = L.latLngBounds(L.latLng(-17.533231, 145.603313), L.latLng(-17.533231, 145.603313));
    minZoom = 5;
    maxZoom = 23;
  }

  // Create basemaps
  const baseLayers = createBaseLayers();

  // Example: create multiple local tile layers (you can add more with createLocalTileLayer)
  // Note: many of the redlynch tiles are stored with TMS y-origin; use tms: true where appropriate
  const orthomosaic = createLocalTileLayer('https://filedn.com/lnwtRrhS2tTy2K4EooXWFnR/tiles/kjellberg0825/ortho/{z}/{x}/{y}.png', {
    tms: true,
    minZoom,
    maxZoom,
    attribution: 'Orthophoto (Kjellberg)'
  });

  // Digital Surface Model layer (added from redlynchdsm directory)
  const dsm = createLocalTileLayer('https://filedn.com/lnwtRrhS2tTy2K4EooXWFnR/tiles/kjellberg0825/dsm/{z}/{x}/{y}.png', {
    // DSM tiles appear to follow the same TMS layout; set tms accordingly if they are bottom-left origin
    tms: true,
    minZoom,
    maxZoom,
    attribution: 'DSM (Kjellberg)',
    opacity: 0.9
  });

  // If you later add other local datasets, create them here:
  // const otherLayer = createLocalTileLayer('othertiles/{z}/{x}/{y}.png', { tms: false, attribution: 'Other' });

  // Initialize the map (start with Google Imagery as the default basemap)
  const map = L.map('map', {
    center: bounds.getCenter(),
    zoom: 18, // Changed default zoom level
    minZoom: minZoom,
    maxZoom: maxZoom,
    // Start with the Google Imagery basemap and enable the orthophoto overlay by default
    layers: [baseLayers.GoogleImagery, orthomosaic]
  });

  // Fit and constrain to bounds
  // map.setMaxBounds(bounds.pad(0.25)); // Keep max bounds constraint - Commented out to fix zoom issue

  // Layer control
  const overlays = {
    'Imagary/Orthophoto': orthomosaic,
    'Digital Surface Map': dsm
    // add other overlays here as you create them
    // 'Other tiles': otherLayer
  };

  const baseLayerControl = {
    'OpenWebMap': baseLayers.OpenWebMap,
    'Esri Imagery': baseLayers.Imagery,
    'Google Imagery': baseLayers.GoogleImagery
  };

  L.control.layers(baseLayerControl, overlays, { collapsed: false }).addTo(map);

  // Add scale
  L.control.scale().addTo(map);

  // Add opacity control for orthomosaic
  const opacityCtrl = new OpacityControl(orthomosaic);
  map.addControl(opacityCtrl);

  // Optional: add orthomosaic to map by default
  // orthomosaic.addTo(map);

  // Convenience: expose map & layers on window for debugging / adding layers in console
  window._map = map;
  window._layers = Object.assign({}, baseLayers, overlays);

  console.log('Map initialized. minZoom=', minZoom, 'maxZoom=', maxZoom, 'bounds=', bounds.toBBoxString());
}

// Run the initializer
init().catch(err => console.error('Initialization failed:', err));
