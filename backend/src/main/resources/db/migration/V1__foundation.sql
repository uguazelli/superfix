create table plans (
  id uuid primary key, name varchar(80) not null unique,
  max_users integer not null check (max_users > 0),
  monthly_ai_limit integer check (monthly_ai_limit > 0),
  active boolean not null
);

create table companies (
  id uuid primary key, name varchar(120) not null,
  plan_id uuid not null references plans, active boolean not null
);

create table accounts (
  id uuid primary key, email varchar(254) not null unique, name varchar(120) not null,
  password_hash varchar(100) not null, role varchar(30) not null,
  company_id uuid references companies, active boolean not null, must_change_password boolean not null,
  check ((role = 'PLATFORM_ADMIN') = (company_id is null)),
  unique (id, company_id)
);
create index accounts_company on accounts(company_id);

create table categories (
  code varchar(40) primary key, label varchar(80) not null,
  active boolean not null, sort_order integer not null
);
insert into categories values
  ('refrigerator','Refrigerator',true,1),
  ('washer','Washing machine',true,2),
  ('dryer','Dryer',true,3),
  ('dishwasher','Dishwasher',true,4),
  ('cooktop','Cooktop',true,5);

create table repair_cases (
  id uuid primary key, company_id uuid not null references companies,
  technician_id uuid not null, category_code varchar(40) not null references categories,
  status varchar(30) not null, version bigint not null,
  created_at timestamptz not null, updated_at timestamptz not null, details jsonb not null,
  foreign key (technician_id,company_id) references accounts(id,company_id),
  unique (id,company_id)
);
create index repair_cases_company_updated on repair_cases(company_id,updated_at desc);
create index repair_cases_technician_updated on repair_cases(technician_id,updated_at desc);

create table ai_requests (
  id uuid primary key, case_id uuid not null, company_id uuid not null,
  client_key uuid not null, status varchar(20) not null, provider varchar(20) not null,
  model varchar(120) not null, contract_version integer not null, locale varchar(12) not null,
  created_at timestamptz not null, started_at timestamptz, finished_at timestamptz,
  input_tokens integer, output_tokens integer,
  foreign key (case_id,company_id) references repair_cases(id,company_id),
  unique (case_id,client_key)
);
create index ai_requests_queue on ai_requests(created_at) where status = 'QUEUED';
create index ai_requests_recovery on ai_requests(started_at) where status = 'RUNNING';
create index ai_requests_quota on ai_requests(company_id,created_at);

create table audit_events (
  id uuid primary key, actor_id uuid not null references accounts, company_id uuid references companies,
  subject_id uuid not null, action varchar(40) not null, created_at timestamptz not null
);

create table spring_session (
  primary_id char(36) primary key, session_id char(36) not null unique,
  creation_time bigint not null, last_access_time bigint not null, max_inactive_interval integer not null,
  expiry_time bigint not null, principal_name varchar(100)
);
create index spring_session_expiry on spring_session(expiry_time);
create index spring_session_principal on spring_session(principal_name);
create table spring_session_attributes (
  session_primary_id char(36) not null references spring_session(primary_id) on delete cascade,
  attribute_name varchar(200) not null, attribute_bytes bytea not null,
  primary key (session_primary_id, attribute_name)
);
alter table spring_session alter column principal_name type varchar(254);
