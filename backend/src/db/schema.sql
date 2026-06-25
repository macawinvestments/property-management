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
