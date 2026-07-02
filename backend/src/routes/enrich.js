import express from 'express';
import { config } from '../config.js';

export const enrichRouter = express.Router();

// FEMA National Flood Hazard Layer (NFHL). The flood hazard zone polygons live
// in layer 28 of the NFHL MapServer. We query point-in-polygon by lng,lat.
// No API key required. We try the query endpoint, and if the service layout
// has shifted, fall back to the identify endpoint.
const NFHL_BASE = 'https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer';

function floodZoneMeaning(zone) {
  if (!zone) return '';
  const z = zone.toUpperCase();
  if (['A', 'AE', 'AH', 'AO', 'AR', 'A99', 'V', 'VE'].some((p) => z === p || z.startsWith(p))) {
    return 'High-risk (Special Flood Hazard Area) — flood insurance typically required';
  }
  if (z === 'X' || z.startsWith('X')) return 'Moderate-to-low risk (outside the SFHA)';
  if (z === 'D') return 'Undetermined risk';
  return '';
}

async function queryFloodLayer(lng, lat) {
  // Layer 28 = Flood Hazard Zones.
  const params = new URLSearchParams({
    geometry: `${lng},${lat}`,
    geometryType: 'esriGeometryPoint',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: 'FLD_ZONE,ZONE_SUBTY,SFHA_TF,DFIRM_ID',
    returnGeometry: 'false',
    f: 'json',
  });
  const url = `${NFHL_BASE}/28/query?${params.toString()}`;
  const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`FEMA query responded ${r.status}`);
  const data = await r.json();
  if (data.error) throw new Error(`FEMA query error ${data.error.code || ''}`);
  return data.features && data.features[0] ? data.features[0].attributes : null;
}

// POST /api/enrich/flood  { lat, lng }
enrichRouter.post('/flood', async (req, res) => {
  const { lat, lng } = req.body || {};
  if (lat == null || lng == null) {
    return res.status(400).json({ error: 'lat and lng are required' });
  }
  try {
    const a = await queryFloodLayer(lng, lat);
    if (!a) {
      return res.json({
        found: false,
        zone: null,
        sfha: null,
        message: 'No FEMA-mapped flood zone at this location (may be unmapped).',
      });
    }
    const zone = a.FLD_ZONE || null;
    res.json({
      found: true,
      zone,
      subtype: a.ZONE_SUBTY || null,
      sfha: a.SFHA_TF === 'T' ? true : a.SFHA_TF === 'F' ? false : null,
      dfirmId: a.DFIRM_ID || null,
      meaning: floodZoneMeaning(zone),
    });
  } catch (err) {
    console.error('[enrich:flood]', err.message);
    res.status(502).json({ error: 'Could not reach FEMA flood service', detail: err.message });
  }
});

// ---- Census / ACS demographics ----
// Coordinates don't map directly to Census data; we first resolve the point to
// a Census tract (state/county/tract FIPS) via the Census geocoder, then pull
// ACS 5-year estimates for that tract.
const CENSUS_GEOCODER =
  'https://geocoding.geo.census.gov/geocoder/geographies/coordinates';
const ACS_BASE = 'https://api.census.gov/data/2022/acs/acs5';

async function pointToTract(lng, lat) {
  const params = new URLSearchParams({
    x: String(lng),
    y: String(lat),
    benchmark: 'Public_AR_Current',
    vintage: 'Current_Current',
    format: 'json',
  });
  const r = await fetch(`${CENSUS_GEOCODER}?${params.toString()}`, { signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`Census geocoder responded ${r.status}`);
  const data = await r.json();
  const tracts = data.result?.geographies?.['Census Tracts'];
  if (!tracts || !tracts[0]) return null;
  const t = tracts[0];
  return {
    state: t.STATE,
    county: t.COUNTY,
    tract: t.TRACT,
    landAreaSqM: t.AREALAND != null ? Number(t.AREALAND) : null, // square meters
    name: t.NAME,
  };
}

// ACS variables:
//  B19013_001E = median household income
//  B01003_001E = total population
//  B01002_001E = median age
//  B11001_001E = total households
//  B25001_001E = total housing units
const ACS_VARS = 'B19013_001E,B01003_001E,B01002_001E,B11001_001E,B25001_001E';

// ---- Regrid parcel & zoning ----
const REGRID_POINT = 'https://app.regrid.com/api/v2/parcels/point';

// Regrid encodes "no data" in zoning numerics as sentinel negatives (-9999,
// -5555). Treat those (and any negative) as null for the zoning rule fields.
function cleanNum(v) {
  if (v == null) return null;
  const n = Number(v);
  if (isNaN(n) || n < 0) return null;
  return n;
}

// POST /api/enrich/parcel  { lat, lng }
enrichRouter.post('/parcel', async (req, res) => {
  const { lat, lng } = req.body || {};
  if (lat == null || lng == null) {
    return res.status(400).json({ error: 'lat and lng are required' });
  }
  if (!config.regridToken) {
    return res.status(503).json({ error: 'Regrid not configured' });
  }
  try {
    const params = new URLSearchParams({
      lat: String(lat),
      lon: String(lng),
      token: config.regridToken,
      return_zoning: 'true',
      return_enhanced_ownership: 'true',
      limit: '1',
    });
    const r = await fetch(`${REGRID_POINT}?${params.toString()}`, { signal: AbortSignal.timeout(20000) });
    if (r.status === 401) return res.status(502).json({ error: 'Regrid rejected the token (401)' });
    if (!r.ok) throw new Error(`Regrid responded ${r.status}`);
    const data = await r.json();

    const feature = data.parcels?.features?.[0];
    if (!feature) {
      return res.json({ found: false, message: 'No parcel found at this location (may be outside coverage).' });
    }
    const f = feature.properties?.fields || {};
    const zoningProps = data.zoning?.features?.[0]?.properties || {};

    res.json({
      found: true,
      // Parcel identity & size
      apn: f.parcelnumb || null,
      useDesc: f.usedesc || null,
      yearBuilt: f.yearbuilt || null,
      lotAcres: f.ll_gisacre != null ? Number(f.ll_gisacre) : null,
      lotSqft: f.ll_gissqft != null ? Number(f.ll_gissqft) : null,
      buildingSqft: f.area_building != null ? Number(f.area_building) : null,
      buildingFootprintSqft: f.ll_bldg_footprint_sqft != null ? Number(f.ll_bldg_footprint_sqft) : null,
      // Zoning
      zoning: f.zoning || zoningProps.zoning || null,
      zoningDescription: f.zoning_description || zoningProps.zoning_description || null,
      maxHeightFt: cleanNum(zoningProps.max_building_height_ft),
      maxFar: cleanNum(zoningProps.max_far),
      maxCoveragePct: cleanNum(zoningProps.max_coverage_pct),
      minLotAreaSqft: cleanNum(zoningProps.min_lot_area_sq_ft),
      // Assessment
      assessedTotal: f.parval != null ? Number(f.parval) : null,
      landValue: f.landval != null ? Number(f.landval) : null,
      improvementValue: f.improvval != null ? Number(f.improvval) : null,
      lastSalePrice: f.saleprice != null ? Number(f.saleprice) : null,
      lastSaleDate: f.saledate || null,
      // Ownership
      owner: f.owner || null,
      owner2: f.owner2 || null,
      ownerMailingAddress: [f.mailadd, f.mail_city, f.mail_state2, f.mail_zip].filter(Boolean).join(', ') || null,
      // Bonus flags
      opportunityZone: f.qoz || null,
      femaRiskRating: f.fema_nri_risk_rating || null,
    });
  } catch (err) {
    console.error('[enrich:parcel]', err.message);
    res.status(502).json({ error: 'Could not reach Regrid service', detail: err.message });
  }
});

// POST /api/enrich/demographics  { lat, lng }
enrichRouter.post('/demographics', async (req, res) => {
  const { lat, lng } = req.body || {};
  if (lat == null || lng == null) {
    return res.status(400).json({ error: 'lat and lng are required' });
  }
  try {
    const geo = await pointToTract(lng, lat);
    if (!geo) {
      return res.json({ found: false, message: 'Could not resolve a Census tract for this location.' });
    }
    const params = new URLSearchParams({
      get: ACS_VARS,
      for: `tract:${geo.tract}`,
      in: `state:${geo.state} county:${geo.county}`,
    });
    if (config.censusApiKey) params.set('key', config.censusApiKey);

    const r = await fetch(`${ACS_BASE}?${params.toString()}`, { signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error(`ACS responded ${r.status}`);
    const rows = await r.json();
    // rows[0] = headers, rows[1] = values
    if (!rows || !rows[1]) return res.json({ found: false, message: 'No ACS data for this tract.' });
    const header = rows[0];
    const vals = rows[1];
    const val = (code) => {
      const i = header.indexOf(code);
      const v = i >= 0 ? Number(vals[i]) : null;
      return v == null || isNaN(v) || v < 0 ? null : v; // ACS uses negatives as null flags
    };
    const population = val('B01003_001E');
    // Density: people per square mile. AREALAND is in square meters.
    let densityPerSqMi = null;
    if (population != null && geo.landAreaSqM) {
      const sqMi = geo.landAreaSqM / 2_589_988.11; // sq meters per sq mile
      if (sqMi > 0) densityPerSqMi = Math.round(population / sqMi);
    }
    res.json({
      found: true,
      tractName: geo.name || null,
      medianHouseholdIncome: val('B19013_001E'),
      population,
      medianAge: val('B01002_001E'),
      households: val('B11001_001E'),
      housingUnits: val('B25001_001E'),
      densityPerSqMi,
    });
  } catch (err) {
    console.error('[enrich:demographics]', err.message);
    res.status(502).json({ error: 'Could not reach Census service', detail: err.message });
  }
});
