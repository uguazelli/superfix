alter table repair_cases alter column category_code drop not null;
alter table repair_cases add column diagnostic_mode varchar(12) not null default 'LEGACY'
  check (diagnostic_mode in ('LEGACY', 'CHAT'));

create table repair_conversations (
  id uuid primary key,
  case_id uuid not null,
  company_id uuid not null,
  handoff jsonb,
  handoff_key uuid,
  handoff_author uuid,
  handoff_saved_at timestamptz,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  unique (id, case_id, company_id),
  unique (case_id, company_id),
  foreign key (case_id, company_id) references repair_cases(id, company_id) on delete cascade,
  foreign key (handoff_author, company_id) references accounts(id, company_id)
);

create table conversation_messages (
  id uuid primary key,
  conversation_id uuid not null,
  case_id uuid not null,
  company_id uuid not null,
  sequence bigint not null,
  role varchar(20) not null check (role in ('TECHNICIAN', 'ASSISTANT', 'CONTEXT')),
  author_id uuid,
  text text not null,
  state varchar(20) not null check (state in ('SAVED', 'QUEUED', 'RUNNING', 'ANSWERED', 'FAILED', 'CANCELLED')),
  failure_code varchar(80),
  client_key uuid,
  reply_to_message_id uuid,
  ai_request_id uuid,
  intake_snapshot jsonb,
  suggestion jsonb,
  created_at timestamptz not null,
  unique (id, case_id, company_id),
  unique (case_id, sequence),
  foreign key (conversation_id, case_id, company_id)
    references repair_conversations(id, case_id, company_id) on delete cascade,
  foreign key (author_id, company_id) references accounts(id, company_id),
  foreign key (reply_to_message_id, case_id, company_id)
    references conversation_messages(id, case_id, company_id) on delete cascade,
  foreign key (ai_request_id) references ai_requests(id) on delete set null
);
create unique index conversation_message_client_key on conversation_messages(case_id, client_key)
  where client_key is not null;
create unique index conversation_assistant_reply on conversation_messages(case_id, reply_to_message_id)
  where reply_to_message_id is not null;
create index conversation_messages_order on conversation_messages(case_id, sequence);
create index conversation_messages_turns on conversation_messages(case_id, state, created_at);

alter table ai_requests add column conversation_message_id uuid;
alter table ai_requests add constraint ai_requests_conversation_message
  foreign key (conversation_message_id) references conversation_messages(id) on delete set null;
create index ai_requests_conversation_message on ai_requests(conversation_message_id)
  where conversation_message_id is not null;

alter table repair_photo_uploads add constraint repair_photo_upload_photo_case_unique
  unique (photo_id, case_id, company_id);
create table conversation_message_photos (
  message_id uuid not null,
  photo_id uuid not null,
  case_id uuid not null,
  company_id uuid not null,
  primary key (message_id, photo_id),
  foreign key (message_id, case_id, company_id)
    references conversation_messages(id, case_id, company_id) on delete cascade,
  foreign key (photo_id, case_id, company_id)
    references repair_photo_uploads(photo_id, case_id, company_id) on delete cascade
);
create index conversation_message_photos_case on conversation_message_photos(case_id, photo_id);

create table conversation_intake_updates (
  id uuid primary key,
  case_id uuid not null,
  company_id uuid not null,
  field_code varchar(40) not null check (field_code in ('category', 'brand', 'model', 'serialNumber', 'symptoms')),
  previous_value text,
  current_value text not null,
  source_message_id uuid not null,
  source_photo_id uuid,
  evidence_quote text not null,
  ai_request_id uuid,
  created_at timestamptz not null,
  foreign key (source_message_id, case_id, company_id)
    references conversation_messages(id, case_id, company_id) on delete cascade,
  foreign key (source_photo_id, case_id, company_id)
    references repair_photo_uploads(photo_id, case_id, company_id) on delete cascade,
  foreign key (ai_request_id) references ai_requests(id) on delete set null
);
create index conversation_intake_updates_case on conversation_intake_updates(case_id, created_at desc);
