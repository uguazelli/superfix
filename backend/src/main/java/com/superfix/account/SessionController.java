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
class SessionController {
    private final AccountService accounts;

    record SessionProfile(User user, Instant offlineUntil) {}

    @GetMapping("/auth/csrf")
    Map<String,String> csrf(CsrfToken token) {
        return Map.of("header", token.getHeaderName(), "token", token.getToken());
    }

    @GetMapping("/auth/me")
    SessionProfile me(Principal principal, jakarta.servlet.http.HttpServletRequest request) {
        var session = request.getSession(false);
        if (session == null) throw new org.springframework.security.access.AccessDeniedException("No session");
        var expires = Instant.ofEpochMilli(session.getLastAccessedTime())
                .plusSeconds(session.getMaxInactiveInterval());
        return new SessionProfile(accounts.profile(principal.getName()), expires);
    }

    @PostMapping("/auth/password")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void password(Principal principal, @RequestBody @Valid NewPassword input, HttpServletRequest request) {
        accounts.changePassword(principal.getName(), input);
        request.getSession(false).invalidate();
    }

    @PutMapping("/auth/locale")
    User locale(Principal principal, @RequestBody @Valid LocaleInput input) {
        return accounts.updateLocale(principal.getName(), input.locale());
    }

}
