alter table accounts add column locale varchar(12) not null default 'en';
alter table accounts add constraint accounts_locale_supported
  check (locale in ('en', 'pt-BR', 'es'));
