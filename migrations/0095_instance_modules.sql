-- 0095_instance_modules.sql (per-deployment modules, docs/modules.md).
-- CREATE-only: no existing table is altered.
--
-- One row per module the owner switched on or off from the desk
-- (PUT /api/admin/modules). No row = the registry default in
-- api/core/modules.mjs. An env hard-off (MODULE_<ID>=off or the module's
-- legacy switch) always wins over this row.
CREATE TABLE IF NOT EXISTS instance_modules (
  id TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  updated_at INTEGER NOT NULL,
  updated_by INTEGER
);
