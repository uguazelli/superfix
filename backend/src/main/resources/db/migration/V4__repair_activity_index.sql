create index audit_events_company_subject_created
  on audit_events(company_id, subject_id, created_at desc);
