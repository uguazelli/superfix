package com.superfix.account;

import static com.superfix.account.AccountDto.*;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import java.security.Principal;
import java.time.Instant;
import java.util.*;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.*;
import org.springframework.http.HttpStatus;
import org.springframework.security.web.csrf.CsrfToken;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1")
@RequiredArgsConstructor
class AccountController {
    private final AccountService accounts;
    @GetMapping("/admin/plans")
    Page<Tier> plans(Principal principal, @RequestParam(defaultValue = "0") int page) {
        return accounts.tiers(actor(principal), page(page));
    }

    @PostMapping("/admin/plans")
    Tier plan(Principal principal, @RequestBody @Valid TierInput input) {
        return accounts.createTier(actor(principal), input);
    }

    @GetMapping("/admin/companies")
    Page<Team> teams(Principal principal, @RequestParam(defaultValue = "0") int page) {
        return accounts.teams(actor(principal), page(page));
    }

    @PostMapping("/admin/companies")
    Team team(Principal principal, @RequestBody @Valid TeamInput input) {
        return accounts.saveTeam(actor(principal), null, input);
    }

    @PutMapping("/admin/companies/{company}")
    Team company(Principal principal, @PathVariable UUID company, @RequestBody @Valid TeamInput input) {
        return accounts.saveTeam(actor(principal), company, input);
    }

    @GetMapping("/admin/companies/{company}/users")
    Page<User> users(Principal principal, @PathVariable UUID company, @RequestParam(defaultValue = "0") int page) {
        return accounts.users(actor(principal), company, page(page));
    }

    @PostMapping("/admin/companies/{company}/users")
    User user(Principal principal, @PathVariable UUID company, @RequestBody @Valid NewUser input) {
        return accounts.createUser(actor(principal), company, input);
    }

    @PutMapping("/admin/companies/{company}/users/{id}/active")
    User active(Principal principal, @PathVariable UUID company, @PathVariable UUID id, @RequestBody @Valid ActiveInput input) {
        return accounts.setActive(actor(principal), company, id, input.active());
    }

    @PutMapping("/admin/companies/{company}/users/{id}/password")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void reset(Principal principal, @PathVariable UUID company, @PathVariable UUID id,
               @RequestBody @Valid TemporaryPassword input) {
        accounts.resetPassword(actor(principal), company, id, input.password());
    }

    private User actor(Principal principal) { return accounts.actor(principal.getName()); }

    private PageRequest page(int page) {
        return PageRequest.of(Math.max(0, page), 25, Sort.by("name", "id"));
    }
}
