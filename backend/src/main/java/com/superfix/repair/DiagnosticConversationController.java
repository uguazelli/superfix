package com.superfix.repair;

import com.superfix.account.AccountService;
import com.superfix.account.AccountDto;
import jakarta.validation.Valid;
import java.security.Principal;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;
import static com.superfix.repair.ConversationRequests.*;
import static com.superfix.repair.DiagnosticConversationService.ConversationView;

@RestController
@RequestMapping("/api/v1/cases/{id}/conversation")
@RequiredArgsConstructor
class DiagnosticConversationController {
    private final AccountService accounts;
    private final DiagnosticConversationService conversations;

    @GetMapping
    ConversationView get(Principal principal, @PathVariable UUID id,
                         @RequestParam(required = false) Long beforeSequence,
                         @RequestParam(defaultValue = "40") int limit) {
        return conversations.get(actor(principal), id, beforeSequence, limit);
    }

    @PostMapping("/start")
    ConversationView start(Principal principal, @PathVariable UUID id, @Valid @RequestBody Start input) {
        return conversations.start(actor(principal), id, input);
    }

    @PostMapping("/messages")
    @ResponseStatus(HttpStatus.CREATED)
    ConversationView message(Principal principal, @PathVariable UUID id, @Valid @RequestBody Message input) {
        return conversations.message(actor(principal), id, input);
    }

    @PostMapping("/messages/{messageId}/retry")
    ConversationView retry(Principal principal, @PathVariable UUID id, @PathVariable UUID messageId,
                           @Valid @RequestBody Retry input) {
        return conversations.retry(actor(principal), id, messageId, input);
    }

    @PostMapping("/continue-to-work")
    ConversationView continueToWork(Principal principal, @PathVariable UUID id, @Valid @RequestBody Handoff input) {
        return conversations.continueToWork(actor(principal), id, input);
    }

    private AccountDto.User actor(Principal principal) { return accounts.technician(principal.getName()); }
}
