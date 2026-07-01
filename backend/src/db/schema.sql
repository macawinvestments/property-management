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
