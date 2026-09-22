-- Original, non-personal workbook snapshots. No learner answers or identity.
CREATE TABLE generated_instances (
  id TEXT PRIMARY KEY NOT NULL,
  instance_hash TEXT NOT NULL UNIQUE CHECK(length(instance_hash) = 64),
  snapshot_hash TEXT NOT NULL CHECK(length(snapshot_hash) = 64),
  snapshot_json TEXT NOT NULL CHECK(length(CAST(snapshot_json AS BLOB)) <= 65536)
);

CREATE TABLE generated_requests (
  key_hash TEXT PRIMARY KEY NOT NULL CHECK(length(key_hash) = 64),
  request_hash TEXT NOT NULL CHECK(length(request_hash) = 64),
  release_id TEXT NOT NULL CHECK(length(release_id) BETWEEN 1 AND 200),
  instance_id TEXT NOT NULL REFERENCES generated_instances(id)
);

CREATE INDEX generated_requests_instance ON generated_requests(instance_id);

CREATE TABLE generated_render_jobs (
  render_spec_hash TEXT PRIMARY KEY NOT NULL CHECK(length(render_spec_hash) = 64),
  instance_id TEXT NOT NULL REFERENCES generated_instances(id),
  variant TEXT NOT NULL CHECK(variant IN ('student', 'answers')),
  renderer_spec TEXT NOT NULL CHECK(length(CAST(renderer_spec AS BLOB)) BETWEEN 1 AND 1024),
  state TEXT NOT NULL CHECK(state IN ('pending', 'claimed', 'complete')),
  claim_token TEXT,
  lease_expires INTEGER,
  artifact_hash TEXT CHECK(artifact_hash IS NULL OR length(artifact_hash) = 64),
  artifact_bytes INTEGER CHECK(artifact_bytes IS NULL OR (artifact_bytes > 8 AND artifact_bytes <= 5242880)),
  CHECK (
    (state = 'pending' AND claim_token IS NULL AND lease_expires IS NULL AND artifact_hash IS NULL AND artifact_bytes IS NULL)
    OR (state = 'claimed' AND claim_token IS NOT NULL AND lease_expires IS NOT NULL AND artifact_hash IS NULL AND artifact_bytes IS NULL)
    OR (state = 'complete' AND claim_token IS NULL AND lease_expires IS NULL AND artifact_hash IS NOT NULL AND artifact_bytes IS NOT NULL)
  )
);

CREATE INDEX generated_render_jobs_instance ON generated_render_jobs(instance_id);
