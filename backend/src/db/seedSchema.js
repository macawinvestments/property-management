import { query } from './pool.js';

// The locked v1 schema (from SCHEMA_DRAFT). Only fields the AI should EXTRACT
// are seeded here as extract=true; the "your assumption" deal fields are
// seeded as extract=false so the UI knows they exist but the AI won't guess.
// destination: overview | deal | proforma | property
const FIELDS = [
  // ---- OVERVIEW (stated facts, all extract) ----
  ['property_name', 'Property / Deal Name', 'text', 'overview', true, 10],
  ['property_address', 'Address', 'text', 'overview', true, 20],
  ['property_type', 'Property Type', 'select', 'overview', true, 30],
  ['property_subtype', 'Property Subtype', 'text', 'overview', true, 40],
  ['building_class', 'Building Class', 'select', 'overview', true, 50],
  ['year_built', 'Year Built', 'number', 'overview', true, 60],
  ['building_size_sf', 'Building Size (SF)', 'number', 'overview', true, 70],
  ['lot_size_ac', 'Lot Size (acres)', 'number', 'overview', true, 80],
  ['lot_size_sf', 'Lot Size (SF)', 'number', 'overview', true, 90],
  ['far', 'Floor Area Ratio (FAR)', 'number', 'overview', true, 100],
  ['parking_spaces', 'Parking Spaces', 'number', 'overview', true, 110],
  ['parking_ratio', 'Parking Ratio (/1,000 SF)', 'number', 'overview', true, 120],
  ['zoning_code', 'Zoning', 'text', 'overview', true, 130],
  ['sale_type', 'Sale Type', 'text', 'overview', true, 140],
  ['tenancy', 'Tenancy', 'select', 'overview', true, 150],
  ['occupancy_pct', 'Occupancy %', 'percent', 'overview', true, 160],
  ['asking_price', 'Asking Price', 'currency', 'overview', true, 170],
  ['price_per_sf', 'Price / SF', 'currency', 'overview', true, 180],
  ['cap_rate_asking', 'Cap Rate (asking / going-in)', 'percent', 'overview', true, 190],
  ['noi_stated', 'NOI (in-place, stated)', 'currency', 'overview', true, 200],
  ['parcel_number', 'Parcel / APN', 'text', 'overview', true, 210],
  ['assessed_total', 'Total Assessment', 'currency', 'overview', true, 220],
  ['assessed_land', 'Land Assessment', 'currency', 'overview', true, 230],
  ['assessed_improvement', 'Improvement Assessment', 'currency', 'overview', true, 240],
  ['listing_broker', 'Listing Broker / Firm', 'text', 'overview', true, 250],
  ['date_on_market', 'Date on Market', 'date', 'overview', true, 260],

  // ---- DEAL calc drivers that ARE facts (extract) ----
  // (these mirror overview facts but map onto the model inputs)
  // name/address/sf/asking/occupancy are already covered by overview keys;
  // the apply step maps overview -> deal. No separate extract rows needed.

  // ---- DEAL assumptions (exist, but AI must NOT extract) ----
  ['offerAmount', 'Offer Amount', 'currency', 'deal', false, 300],
  ['capitalizedRehab', 'Capitalized Rehab', 'currency', 'deal', false, 310],
  ['nonCapitalizedRehab', 'Non-Capitalized Rehab', 'currency', 'deal', false, 320],
  ['incomePerSF', 'Income / SF (annual)', 'currency', 'deal', false, 330],
  ['downPaymentPct', 'Down Payment %', 'percent', 'deal', false, 340],
  ['interestRate', 'Interest Rate', 'percent', 'deal', false, 350],
  ['termYears', 'Loan Term (years)', 'number', 'deal', false, 360],
];

export async function seedSchema() {
  for (const [field_key, label, field_type, destination, extract, sort_order] of FIELDS) {
    await query(
      `INSERT INTO schema_fields (field_key, label, field_type, destination, extract, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (field_key) DO UPDATE
         SET label=$2, field_type=$3, destination=$4, extract=$5, sort_order=$6`,
      [field_key, label, field_type, destination, extract, sort_order]
    );
  }
  console.log(`[seed] schema_fields seeded (${FIELDS.length} fields).`);
}
