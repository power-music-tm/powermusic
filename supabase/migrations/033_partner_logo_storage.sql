-- Partner avatar object storage (Instagram-style: public CDN URLs, not DB blobs).

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'partner-logos',
  'partner-logos',
  true,
  2097152,
  ARRAY['image/png', 'image/jpeg', 'image/webp']::text[]
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Public read — logos are non-sensitive branding assets.
CREATE POLICY "Partner logos public read"
ON storage.objects
FOR SELECT
TO public
USING (bucket_id = 'partner-logos');

ALTER TABLE IF EXISTS partner_custom_forms
  ADD COLUMN IF NOT EXISTS logo_url TEXT;
