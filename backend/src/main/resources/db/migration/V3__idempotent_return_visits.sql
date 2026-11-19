alter table repair_returns add column client_key uuid;
create unique index repair_returns_case_client_key
  on repair_returns(case_id, client_key)
  where client_key is not null;
