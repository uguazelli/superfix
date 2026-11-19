package com.superfix.account;

import org.mapstruct.Mapper;

@Mapper(componentModel = "spring")
interface AccountMapper {
    AccountDto.User user(Account source);
    AccountDto.Team team(Company source);
    AccountDto.Tier tier(Plan source);
}
