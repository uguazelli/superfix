alter table ai_requests
  add column diagnostic_decision varchar(32),
  add column diagnostic_reason varchar(80),
  add column model_note varchar(500),
  add column response_text text,
  add column response_kind varchar(24),
  add column response_truncated boolean not null default false;
