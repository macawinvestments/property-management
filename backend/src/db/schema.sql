-- The deals table.
-- `data` holds the entire deal input state as JSON so a saved deal restores
-- exactly. The extracted columns (name, address, status, purchase_price,
-- key metrics) exist so the pipeline list can sort/filter without parsing JSON.

CREATE TABLE IF NOT EXISTS deals (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL DEFAULT '',
  address       TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'active',  -- active | accepted | declined
  purchase_price NUMERIC,
  irr           NUMERIC,        -- a headline metric for the list (optional)
  data          JSONB NOT NULL, -- full deal input state
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_deals_status ON deals(status);
CREATE INDEX IF NOT EXISTS idx_deals_updated ON deals(updated_at DESC);

-- The documents table. Files live in R2 (object storage); this table stores
-- metadata + the storage key so we can list, download, and delete per deal.
CREATE TABLE IF NOT EXISTS documents (
  id           SERIAL PRIMARY KEY,
  deal_id      INTEGER NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  category     TEXT NOT NULL DEFAULT 'others',   -- DD category key, or 'others'
  filename     TEXT NOT NULL,
  mime_type    TEXT,
  size_bytes   BIGINT,
  storage_key  TEXT NOT NULL,   -- key in the R2 bucket
  uploaded_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_documents_deal ON documents(deal_id);
CREATE INDEX IF NOT EXISTS idx_documents_category ON documents(deal_id, category);

-- The extraction SCHEMA table — the master list of fields the AI looks for.
-- This is the "file that grows": new fields can be added at runtime (promoted
-- from discovered facts) without a redeploy.
CREATE TABLE IF NOT EXISTS schema_fields (
  id            SERIAL PRIMARY KEY,
  field_key     TEXT UNIQUE NOT NULL,   -- machine name, stable
  label         TEXT NOT NULL,          -- shown to user
  field_type    TEXT NOT NULL DEFAULT 'text', -- currency|number|percent|text|select|bool|date
  destination   TEXT NOT NULL DEFAULT 'overview', -- overview|deal|proforma|property
  extract       BOOLEAN NOT NULL DEFAULT true,  -- should the AI try to find it?
  sort_order    INTEGER NOT NULL DEFAULT 100,
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_schema_extract ON schema_fields(extract);

-- Per-deal extraction results. Stores what the AI pulled from a document,
-- including source page/snippet, and any "additional facts found" (extras).
-- Nothing is lost: everything the AI surfaces lands here.
CREATE TABLE IF NOT EXISTS extractions (
  id            SERIAL PRIMARY KEY,
  deal_id       INTEGER NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  document_id   INTEGER REFERENCES documents(id) ON DELETE SET NULL,
  source_name   TEXT,                   -- filename extracted from
  known_fields  JSONB NOT NULL DEFAULT '{}',  -- { field_key: {value, page, source_text} }
  extra_facts   JSONB NOT NULL DEFAULT '[]',  -- [ {label, value, type, page, source_text} ]
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_extractions_deal ON extractions(deal_id);
