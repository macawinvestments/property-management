# PROPERTY-MANAGEMENT — PROJECT HANDOFF
_Last updated: end of the build session that added OM extraction._
_Purpose: give a fresh Claude instance everything needed to continue this build without re-explaining. Read this first._

═══════════════════════════════════════════════════════════════
## 1. WHAT THIS IS
═══════════════════════════════════════════════════════════════

A commercial real-estate **deal-underwriting web app** that Jose (founder of Macaw Investments) is building to sell/license to client **Otima Investments**. It models deals, tracks due diligence, stores documents, pulls address-driven property data, and auto-extracts data from offering memoranda (OMs) using Claude.

**Stack:**
- **Frontend:** React + Vite → deployed on **Vercel**
- **Backend:** Node/Express → deployed on **Railway**
- **Database:** PostgreSQL (on Railway)
- **File storage:** Cloudflare **R2** (S3-compatible)
- **AI extraction:** Anthropic API (Claude, model `claude-sonnet-4-6`)
- **Address:** Google Places Autocomplete
- **Enrichment APIs:** FEMA (flood), US Census (demographics), Regrid (parcel/zoning)

**Repo:** `macawinvestments/property-management` (monorepo: `frontend/` + `backend/` subfolders). Auto-deploys on push (Railway watches `/backend`, Vercel watches `/frontend`).

═══════════════════════════════════════════════════════════════
## 2. JOSE'S ENVIRONMENT & WORKING STYLE (important)
═══════════════════════════════════════════════════════════════

- Works across a **desktop** (`C:\Users\josec\OneDrive\Macaw Investments\AI\property-management`) and **laptop** (`C:\Users\jcrm6\OneDrive\...` — `jcrm6` is correct for the laptop, NOT a typo to fix). Synced via OneDrive EXCEPT `node_modules` and `.env` (gitignored — install/create per machine).
- Uses **PowerShell**. Prefers `Invoke-RestMethod` (NOT `curl` — curl triggers a PowerShell security warning). New PowerShell windows open in `system32`, so always `cd` to the project folder first.
- Deploys via `git add -A → commit → push` (auto-deploys). He does his own deploys and env-var setup.
- **Delivery pattern:** Claude builds files in its workspace, delivers them via `present_files`, and Jose copies them with `Copy-Item ... -Force` (or `Expand-Archive` for zips). ALWAYS give the exact `Copy-Item` commands with his laptop path.
- **Build style:** step-by-step, one thing at a time, confirm before proceeding. He wants things BUILT and ready to use, not explained theoretically. He corrects course fast. He appreciates honest pushback and reasoning behind decisions — don't just agree, tell him the real tradeoffs.
- After every code edit, Claude balance-checks braces/parens with a node one-liner before delivering:
  `node -e "const fs=require('fs');const t=fs.readFileSync('App.jsx','utf8');const b=(t.match(/{/g)||[]).length-(t.match(/}/g)||[]).length;const p=(t.match(/\(/g)||[]).length-(t.match(/\)/g)||[]).length;console.log(b||p?'CHECK':'OK');"`
  (JSX can skew naive counts; if it flags, use a tokenizer-aware check.)

═══════════════════════════════════════════════════════════════
## 3. DEPLOYMENT STATE (all live & deployed)
═══════════════════════════════════════════════════════════════

- **Vercel** production URL: `https://property-management-iota-dusky.vercel.app` (this stable domain is what's in the Google key referrer restrictions — always test here, not build-specific URLs).
- **Railway** backend public URL: `https://property-management-production-6837.up.railway.app`
- **Railway** has TWO services: `property-management` (backend, GitHub icon) and `Postgres`.

**Vercel env vars** (frontend, `VITE_` prefix = baked into build, must redeploy after changes):
- `VITE_API_URL` = the Railway backend URL
- `VITE_GOOGLE_MAPS_KEY` = Google Maps/Places key

**Railway env vars** (backend service):
- `DATABASE_URL`, `APP_PASSWORD` (=`otimamacaw2025@`), `ALLOWED_ORIGIN`
- `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` (=`otima-documents`)
- `CENSUS_API_KEY`, `REGRID_TOKEN`, `ANTHROPIC_API_KEY`

**Health check** (`GET /api/health`) reports: `dbConnected`, `r2Configured`, `extractionConfigured`. All should be `true` in prod.

**⚠️ SECURITY ACTION ITEM (still pending):** During this build, real secrets were pasted in chat — R2 keys, Postgres password, and the Regrid sandbox token. **These should be rotated** before the app is in active/client use:
- R2: regenerate token in Cloudflare, update local `.env` + Railway.
- Postgres: optionally rotate in Railway.
- Regrid: sandbox token (expires 2026-08-01 anyway).
Jose is aware; remind him before go-live.

═══════════════════════════════════════════════════════════════
## 4. DATABASE SCHEMA (Postgres)
═══════════════════════════════════════════════════════════════

Tables (created via `npm run initdb` which runs `schema.sql` + `seedSchema.js`):

- **deals**: id, name, address, status (active|accepted|declined), purchase_price, irr, data JSONB (full deal state), created_at, updated_at.
- **documents**: id, deal_id (FK→deals CASCADE), category (DD category key or 'others'), filename, mime_type, size_bytes, storage_key (R2 key), uploaded_at.
- **schema_fields**: id, field_key (unique), label, field_type (currency|number|percent|text|select|bool|date), destination (overview|deal|proforma|property), extract (bool), sort_order, notes, created_at. — THE EXTRACTION SCHEMA ("the file that grows"). Seeded with 33 fields.
- **extractions**: id, deal_id (FK CASCADE), document_id (FK→documents SET NULL), source_name, known_fields JSONB ({field_key:{value,page,source_text}}), extra_facts JSONB ([{label,value,type,page,source_text}]), created_at.

**IMPORTANT:** When deploying schema changes, run `npm run initdb` locally — Jose's local `.env` `DATABASE_URL` points at the Railway public Postgres, so local `initdb` migrates PRODUCTION. Without it, new tables won't exist in prod and features break.

═══════════════════════════════════════════════════════════════
## 5. BACKEND STRUCTURE (`backend/src/`)
═══════════════════════════════════════════════════════════════

- **config.js** — reads all env vars incl. `r2` (with derived `endpoint` getter), `censusApiKey`, `regridToken`, `anthropicApiKey`.
- **server.js** — Express app. Mounts (all password-protected via `requirePassword` middleware except `/api/login` and `/api/health`):
  - `/api/login` (POST, checks password)
  - `/api/deals` → dealsRouter
  - `/api/documents` → documentsRouter
  - `/api/enrich` → enrichRouter (flood/demographics/parcel)
  - `/api/extract` → extractRouter (schema + extraction)
  - `/api/health`
- **middleware/auth.js** — `requirePassword` checks `x-app-password` header against `APP_PASSWORD`.
- **db/pool.js** — pg pool (SSL on when remote), exports `query` and `pool`.
- **db/schema.sql** — all table DDL (IF NOT EXISTS).
- **db/seedSchema.js** — `seedSchema()` upserts the 33 schema_fields rows.
- **db/init.js** — `npm run initdb`: applies schema.sql then seeds.
- **storage/r2.js** — S3Client for R2: `uploadObject`, `signedDownloadUrl`, `deleteObject`, `r2Configured()`.
- **routes/deals.js** — CRUD for deals (list/get/create/update/status/delete). Saves full deal state JSON + extracts columns (name, address, status, purchase_price, irr from data.summary.irr).
- **routes/documents.js** — upload (multer memory, 50MB cap, blocks executables, streams to R2 key `deals/{dealId}/{category}/{uuid}-{filename}`), list, signed URL, delete.
- **routes/enrich.js** — `/flood` (FEMA NFHL layer 28 point query, no key), `/demographics` (Census geocoder→tract then ACS 2022/acs5, uses CENSUS_API_KEY), `/parcel` (Regrid `/parcels/point`, uses REGRID_TOKEN; cleans sentinel negatives like -9999).
- **routes/extract.js** — `/schema` (GET field list), `/:dealId` (POST {documentId}: fetches PDF from R2, base64, sends to Claude `claude-sonnet-4-6` with document block + schema-built prompt, parses JSON {known_fields, extra_facts}, stores in extractions table), `/:dealId/history` (GET past extractions).

**Backend deps** (package.json): express, cors, dotenv, pg, @aws-sdk/client-s3, @aws-sdk/s3-request-presigner, multer, @anthropic-ai/sdk.

═══════════════════════════════════════════════════════════════
## 6. FRONTEND STRUCTURE (`frontend/src/`)
═══════════════════════════════════════════════════════════════

- **App.jsx** (~1780 lines) — everything. `App` wrapper → LoginGate or DealApp. `DealApp` holds all state and the tabs.
- **api.js** — all backend calls. Base = `VITE_API_URL` or localhost:8080. Password in localStorage, sent as `x-app-password`. Methods: login, deals CRUD, documents (list/upload/url/delete), enrich (getFloodZone/getDemographics/getParcel), extract (getSchema/extractDocument/extractionHistory).
- **AddressAutocomplete.jsx** — Google Places widget. Loads Maps JS lib (key from `VITE_GOOGLE_MAPS_KEY`), on select stores {address, placeId, lat, lng}. Falls back to plain input if no key.
- **dueDiligence.js** — DD_CATEGORIES (13 categories, 132 items), DD_STATUSES, DD_PRIORITIES, DD_RISKS, ddItemId().
- **styles.css** — dark institutional theme: ink-navy `#0e1b2a`, gold `#c8a24c`, Fraunces (serif/money), IBM Plex Mono (data), Inter (labels).

**Design aesthetic:** blue/navy + gold, serif for money figures, mono for data. Minimal, institutional. Calculated fields = dashed gold read-only boxes. Editable inputs show RAW text (don't reformat while typing).

**Masthead:** brand, Save/Update Deal button, Pipeline button (toggles pipeline view), Settings, Lock.
**Tabs (in order):** Overview | Deal Inputs | Proforma | Property Data | Due Diligence | Documents.
(Pipeline is a masthead button, NOT a bottom tab.)

═══════════════════════════════════════════════════════════════
## 7. THE TABS — WHAT EACH DOES
═══════════════════════════════════════════════════════════════

**OVERVIEW (OverviewTab)** — the OM intake/extraction page. Upload PDF(s) (saved to R2 as 'others' category), pick one, "Extract data" → Claude reads it → shows Known Fields (each with checkbox + page + source snippet) and "Additional Facts Found" (discovery bucket). "Apply selected to deal" pushes MODEL-MAPPED facts into Deal Inputs. Loads last extraction from DB on mount (persists across tab switches / reopening). `OVERVIEW_TO_DEAL` maps: property_name→name, property_address→address, building_size_sf→squareFootage, asking_price→askingPrice, occupancy_pct→occupancyPct.

**DEAL INPUTS** — the model. All calcs validated against Otima's real Excel to the dollar. Editable: name, address (Google autocomplete), squareFootage, askingPrice, **offerAmount** (whole $ — NEW, replaced old offerPct; offer % of asking now shown as derived), capitalizedRehab, nonCapitalizedRehab, occupancyPct, incomePerSF, downPaymentPct (def 30), interestRate, termYears (def 30), amortType (pi|io), useMezz + mezz fields. Calculated: purchasePrice (=offerAmount), loan/debt/mezz, operating capital lines, totalProjectCost, totalForClosing. (Old deals with offerPct auto-migrate to offerAmount on open.)

**PROFORMA** — 10-year projection, rate-driven, refi toggle. GPR, vacancy, NNN, expenses, NOI, DSCR, debt yield, cash flow, ROI, GP allocation ramp, sale/returns waterfall. Widens to 1400px (`.app.wide`). Manual per-year arrays: miscByYear, nnnByYear, expensesAnnuallyByYear, leasingCapexTiByYear.

**PROPERTY DATA (PropertyTab)** — address-driven enrichment. Uses deal's stored lat/lng. Three independent pull sections (each saves to deal.propertyData, kept separate):
  - **Flood Zone** (FEMA) — zone, SFHA flag, assessment.
  - **Area Demographics** (Census) — median income, population, density, median age, households, housing units.
  - **Parcel & Zoning** (Regrid) — APN, use, lot size, year built, building area/footprint; zoning code/desc/max height/FAR/coverage/min lot; assessed total/land/improvement; last sale; owner/co-owner/mailing; Opportunity Zone; FEMA risk rating.

**DUE DILIGENCE (DueDiligenceTab)** — 13 categories, 132 items. Overview recap (overall % + risk flag + per-category cards) then a selector to work one category at a time. Each item tracked: status/priority/owner/3 dates/risk/comments. Saves per-deal in `dd` state keyed "catKey:itemIndex".

**DOCUMENTS (DocumentsTab)** — 14 folders (13 DD categories + Others). Upload multiple files any type (50MB cap, blocks executables), stored in R2. Preview (images/PDF, opens signed URL) or Download (Office). Delete. Requires saved deal.

**PIPELINE (PipelineTab)** — saved deals grouped by status, with IRR column. Masthead button toggles it.

═══════════════════════════════════════════════════════════════
## 8. THE EXTRACTION FEATURE (most recent build) — HOW IT WORKS
═══════════════════════════════════════════════════════════════

The core vision Jose designed:
- **Overview is the source of truth.** Upload OM → extract EVERYTHING useful → review with source references → apply to downstream tabs. "As to not miss anything."
- **Stated facts stay separate from Jose's underwriting.** The OM's stated NOI ≠ Jose's underwritten NOI. Overview holds what the doc SAYS; Deal/Proforma hold Jose's assumptions (which start from the Overview but he overrides).
- **The schema is a DB table that GROWS.** Extraction prompts against `schema_fields`. The AI also returns "additional facts found" (open-ended discovery). Nothing is lost. LATER (v2, not built): promote recurring extra_facts into permanent schema_fields ("+ Add as field" loop). The AI has no memory — the backend feeds it the schema each call; the DB is the memory.
- **Assisted, never autonomous.** AI proposes, Jose verifies (checkboxes + page/snippet source), Jose applies. Never auto-decides. `extract: false` fields (his financing assumptions) are never guessed.
- **v1 decisions locked:** extract only STATED values (no derivation); ⚠️ fields (income/SF, expenses, NNN) extract to Overview but don't auto-push to model; rent roll reserved for later.

**Extraction mechanic:** backend reads schema_fields → builds prompt listing extractable fields → sends PDF (base64 document block) + prompt to `claude-sonnet-4-6` → model returns strict JSON {known_fields:{key:{value,page,source_text}}, extra_facts:[...]} → stored in extractions table → frontend shows for review.

**Tested & working** on LoopNet listing PDFs (extracts asking price, SF, NOI, cap rate, year built, zoning, etc. with page sources). Real OM/CIM extraction is the next real-world test Jose will do.

═══════════════════════════════════════════════════════════════
## 9. ROADMAP — WHAT'S NEXT (not yet built)
═══════════════════════════════════════════════════════════════

Open items, roughly in Jose's priority order:
1. **Rent Roll / Tenants section** (Property Data) — MANUAL entry (no API gives rent rolls). One row per tenant: name, suite, SF, lease start/end, base rent, escalations, options. Then computed: occupancy, WALT, in-place rent. Schema fields already reserved (section D of schema draft).
2. **Schema-growth v2** — the "+ Add as field" loop: promote recurring extra_facts into permanent schema_fields without redeploy.
3. **Expand extraction destinations** — currently only 5 fields map Overview→Deal. Expand to push more (Proforma NOI/expenses, Property Data facts) once the stated-vs-assumed UX is designed.
4. **IRR** — Jose has a "simpler" IRR method he'll explain (an earlier complex attempt was abandoned; there was an example: initial -18,610,993, Yr1-5 investor CF ending with CF+Sale, IRR 12.91% — a bisection solver matched it). Also the 5/7/10yr summary boxes (Avg Yield P.A., Total Return, AAR, Equity Multiple).
5. **Portfolio comparison + hard yes/no analyzer** — run saved deals through the engine, score against buy-box criteria, pass/fail. Runs on already-verified data.
6. **Regrid paid plan decision** — trial is 7 counties (Dallas TX confirmed works; PA/McKees Rocks NOT covered), expires 2026-08-01. Self-serve subscription likely the fit. Needed for real PA deals.
7. **Google imagery** (satellite/street view) — skipped earlier, easy to add if wanted.

═══════════════════════════════════════════════════════════════
## 10. PRICING DISCUSSION (deferred, for when Jose returns to it)
═══════════════════════════════════════════════════════════════

Jose wants to sell IP to Otima + keep recurring monthly (maintenance, upgrades, on-demand versions, data entry via his Honduras ops team).
Claude's honest framing:
- **Don't sell IP outright unless the check is large** (~$75k-200k) — it kills the product/recurring-revenue upside and the ability to license to other firms.
- **Preferred structure:** LICENSE (retain IP) + build/setup fee (~$15-40k) + monthly retainer ($1k-5k, covering hosting/maintenance/dev-hours/data-entry) + exclusivity priced separately if Otima wants competitors excluded.
- Price on VALUE (time saved × deal volume), not build hours.
- Get a lawyer for IP/licensing terms. Claude is not a lawyer/financial advisor — framing only.
- Key unknowns that set the number: Otima's annual deal volume, whether they want exclusivity, data-entry volume.

═══════════════════════════════════════════════════════════════
## 11. KEY REFERENCE FILES (uploaded during build, may be re-uploadable)
═══════════════════════════════════════════════════════════════

- `Damascus_Shopping_Center_-_Maryland_-_2026.xlsx` — Otima's REAL syndication model. The Deal/Proforma math was validated against this to the dollar.
- `Valley_Crossing_Weslaco_-_OM_04_04_25.pdf` — a real 15MB CBRE OM (test doc for extraction).
- `Private_Equity_Commercial_Real_Estate_Due_Diligence_Master.xlsx` — the 14-tab DD master that became the Due Diligence tab (13 categories, 132 items).
- `TEST.pdf` (Escalon Crossing) + `TES_2.pdf` (Harry Wurzbach) — LoopNet listing PDFs, used to test extraction. Both San Antonio TX. Extract cleanly.
- `regrid-open-api-v2.yaml` — Regrid API spec. `/parcels/point?lat=&lon=&token=` is the endpoint used.

═══════════════════════════════════════════════════════════════
## 12. HOW TO CONTINUE (for the fresh Claude instance)
═══════════════════════════════════════════════════════════════

1. **Ask Jose to upload the current `App.jsx`, `api.js`, `styles.css`** (frontend) and any backend files you'll modify — his deployed version is the source of truth (he deploys independently; your workspace may be behind). Build on HIS current files, not assumptions.
2. Confirm what he wants to build next (see roadmap §9).
3. Build ONE thing at a time, deliver via files with exact `Copy-Item` commands (laptop path `C:\Users\jcrm6\OneDrive\Macaw Investments\AI\property-management\...`), balance-check before delivering.
4. Give him startup commands when needed: backend `cd ...\backend; npm start`, frontend `cd ...\frontend; npm run dev` → open `http://localhost:5173/`.
5. For DB schema changes, remind him to run `npm run initdb` (hits prod DB via his local .env).
6. For deploys: new backend env vars → Railway; new `VITE_` vars → Vercel (+ redeploy cache-off); `git add -A && commit && push`; run initdb if schema changed; verify `/api/health`.
7. Be honest, give real tradeoffs, don't over-agree. He values reasoning.

_End of handoff._
