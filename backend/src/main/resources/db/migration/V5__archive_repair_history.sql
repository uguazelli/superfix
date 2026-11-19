alter table repair_cases add column archived_at timestamptz;
alter table repair_cases add column archived_by uuid;
alter table repair_cases add constraint repair_cases_archive_actor_pair
  check ((archived_at is null) = (archived_by is null));
alter table repair_cases add constraint repair_cases_archive_closed_only
  check (archived_at is null or status = 'CLOSED');

alter table repair_cases add constraint repair_cases_archiver_company
  foreign key (archived_by, company_id) references accounts(id, company_id);

create index repair_cases_company_archived_updated
  on repair_cases(company_id, updated_at desc)
  where archived_at is not null;
