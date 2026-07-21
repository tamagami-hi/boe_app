CREATE TABLE IF NOT EXISTS app_config_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  config_key text NOT NULL DEFAULT 'mobile_app',
  version integer NOT NULL,
  config_json jsonb NOT NULL,
  status text NOT NULL DEFAULT 'published',
  published_by uuid REFERENCES users (id) ON DELETE SET NULL,
  published_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT app_config_versions_key_chk CHECK (length(trim(config_key)) > 0),
  CONSTRAINT app_config_versions_version_chk CHECK (version > 0),
  CONSTRAINT app_config_versions_json_chk CHECK (jsonb_typeof(config_json) = 'object'),
  CONSTRAINT app_config_versions_status_chk CHECK (status IN ('published', 'archived'))
);

CREATE UNIQUE INDEX IF NOT EXISTS app_config_versions_key_version_uidx
  ON app_config_versions (config_key, version);
CREATE INDEX IF NOT EXISTS app_config_versions_key_published_idx
  ON app_config_versions (config_key, published_at DESC);
CREATE INDEX IF NOT EXISTS app_config_versions_published_by_idx
  ON app_config_versions (published_by);
