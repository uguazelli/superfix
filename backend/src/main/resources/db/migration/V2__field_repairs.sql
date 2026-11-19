create sequence repair_job_reference_seq start with 10001;

alter table repair_cases add column job_reference varchar(20);
alter table repair_cases add column created_by uuid;
alter table repair_cases add column client_key uuid;
alter table repair_cases add column appliance_id uuid;
alter table repair_cases add column parent_case_id uuid;
alter table repair_cases add column appliance_serial_key varchar(120);

update repair_cases
set job_reference = 'SF-' || lpad(nextval('repair_job_reference_seq')::text, 8, '0'),
    created_by = technician_id,
    appliance_serial_key = nullif(lower(trim(details #>> '{intake,serialNumber}')), '');

alter table repair_cases alter column job_reference set not null;
alter table repair_cases alter column created_by set not null;
create unique index repair_cases_job_reference on repair_cases(job_reference);
create unique index repair_cases_company_client_key on repair_cases(company_id, client_key) where client_key is not null;
create index repair_cases_parent on repair_cases(parent_case_id, company_id) where parent_case_id is not null;
create index repair_cases_company_serial on repair_cases(company_id, appliance_serial_key) where appliance_serial_key is not null;
alter table repair_cases add constraint repair_cases_creator_company
  foreign key (created_by, company_id) references accounts(id, company_id);
alter table repair_cases add constraint repair_cases_parent_company
  foreign key (parent_case_id, company_id) references repair_cases(id, company_id);

create table appliances (
  id uuid primary key,
  company_id uuid not null references companies,
  category_code varchar(40) not null references categories,
  brand varchar(120),
  model varchar(120) not null,
  serial_number varchar(120),
  brand_key varchar(120) not null,
  model_key varchar(120) not null,
  serial_key varchar(120),
  created_by uuid not null,
  created_at timestamptz not null,
  unique (id, company_id),
  foreign key (created_by, company_id) references accounts(id, company_id)
);
create unique index appliances_serial_identity on appliances(company_id, category_code, brand_key, model_key, serial_key)
  where serial_key is not null;
create index appliances_company_model on appliances(company_id, category_code, brand_key, model_key);
create index appliances_company_serial on appliances(company_id, serial_key) where serial_key is not null;
alter table repair_cases add constraint repair_cases_appliance_company
  foreign key (appliance_id, company_id) references appliances(id, company_id);

create table repair_assignments (
  id uuid primary key,
  case_id uuid not null,
  company_id uuid not null,
  actor_id uuid not null,
  previous_technician_id uuid,
  technician_id uuid not null,
  note varchar(1000),
  created_at timestamptz not null,
  foreign key (case_id, company_id) references repair_cases(id, company_id),
  foreign key (actor_id, company_id) references accounts(id, company_id),
  foreign key (previous_technician_id, company_id) references accounts(id, company_id),
  foreign key (technician_id, company_id) references accounts(id, company_id)
);
create index repair_assignments_case on repair_assignments(case_id, created_at);

create table repair_returns (
  id uuid primary key,
  case_id uuid not null,
  company_id uuid not null,
  scheduled_for date not null,
  status varchar(20) not null check (status in ('SCHEDULED', 'STARTED', 'COMPLETED', 'CANCELLED')),
  reason varchar(1000) not null,
  next_action varchar(1000) not null,
  created_by uuid not null,
  created_at timestamptz not null,
  started_at timestamptz,
  completed_at timestamptz,
  unique (id, company_id),
  foreign key (case_id, company_id) references repair_cases(id, company_id),
  foreign key (created_by, company_id) references accounts(id, company_id)
);
create unique index repair_returns_one_active_per_case on repair_returns(case_id)
  where status in ('SCHEDULED', 'STARTED');
create index repair_returns_due on repair_returns(company_id, scheduled_for)
  where status = 'SCHEDULED';

create table repair_return_parts (
  id uuid primary key,
  return_id uuid not null,
  company_id uuid not null references companies,
  name varchar(120) not null,
  part_number varchar(120),
  quantity integer not null check (quantity between 1 and 999),
  status varchar(20) not null check (status in ('REQUESTED', 'RECEIVED', 'CANCELLED')),
  foreign key (return_id, company_id) references repair_returns(id, company_id)
);
create index repair_return_parts_visit on repair_return_parts(return_id);

create table repair_photo_uploads (
  id uuid primary key,
  case_id uuid not null,
  company_id uuid not null,
  client_key uuid not null,
  photo_id uuid not null,
  created_at timestamptz not null,
  foreign key (case_id, company_id) references repair_cases(id, company_id),
  unique (case_id, client_key)
);
