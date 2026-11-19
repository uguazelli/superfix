package com.superfix.repair;

import static com.superfix.repair.RepairData.*;
import static com.superfix.repair.RepairRequests.*;
import com.superfix.account.*;
import jakarta.validation.Valid;
import java.io.IOException;
import java.security.Principal;
import java.time.LocalDate;
import java.util.*;
import lombok.RequiredArgsConstructor;
import org.springframework.core.io.Resource;
import org.springframework.data.domain.Page;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

@RestController
@RequestMapping("/api/v1")
@RequiredArgsConstructor
class RepairController {
    private final AccountService accounts;
    private final RepairService service;
    private final DiagnosticAi ai;
    private final PilotOutcomeService pilotOutcomes;

    record CategoryView(String code, String label) {}
    record AppSettings(boolean demo) {}

    @GetMapping("/settings")
    AppSettings settings(Principal principal) {
        accounts.technician(principal.getName());
        return new AppSettings(ai.mode().equals("mock"));
    }

    @GetMapping("/categories")
    List<CategoryView> categories(Principal principal) {
        accounts.technician(principal.getName());
        return service.categories().stream().map(c -> new CategoryView(c.code, c.label)).toList();
    }

    @GetMapping("/team/technicians")
    List<AccountDto.User> technicians(Principal principal) {
        return accounts.technicians(accounts.actor(principal.getName()));
    }

    @GetMapping("/cases")
    Page<Summary> list(Principal principal, @RequestParam(required = false) String category,
                       @RequestParam(required = false) Status status, @RequestParam(required = false) String search,
                       @RequestParam(defaultValue = "false") boolean archived,
                       @RequestParam(defaultValue = "0") int page) {
        return service.list(actor(principal), category, status, search, archived, page);
    }

    @PostMapping("/cases/{id}/archive")
    View archive(Principal principal, @PathVariable UUID id, @Valid @RequestBody Archive input) {
        return service.archive(actor(principal), id, input);
    }

    @PostMapping("/cases/{id}/restore")
    View restore(Principal principal, @PathVariable UUID id, @Valid @RequestBody Archive input) {
        return service.restore(actor(principal), id, input);
    }

    @DeleteMapping("/cases/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void deleteArchived(Principal principal, @PathVariable UUID id, @RequestParam long version) {
        service.deleteArchived(actor(principal), id, version);
    }

    @PostMapping("/cases")
    @ResponseStatus(HttpStatus.CREATED)
    View create(Principal principal, @RequestHeader(name = "Idempotency-Key", required = false) UUID clientKey,
                @Valid @RequestBody Intake intake) {
        return service.create(actor(principal), intake, clientKey == null ? UUID.randomUUID() : clientKey);
    }

    @PostMapping("/cases/{id}/callbacks")
    @ResponseStatus(HttpStatus.CREATED)
    View callback(Principal principal, @PathVariable UUID id,
                  @RequestHeader(name = "Idempotency-Key", required = false) UUID clientKey,
                  @Valid @RequestBody Callback input) {
        return service.callback(actor(principal), id, input, clientKey == null ? UUID.randomUUID() : clientKey);
    }

    @PutMapping("/cases/{id}/assignee")
    View assign(Principal principal, @PathVariable UUID id, @Valid @RequestBody Assign input) {
        return service.assign(actor(principal), id, input);
    }

    @PutMapping("/cases/{id}/appliance")
    View confirmAppliance(Principal principal, @PathVariable UUID id, @Valid @RequestBody ConfirmAppliance input) {
        return service.confirmAppliance(actor(principal), id, input);
    }

    @GetMapping("/pilot-outcomes")
    List<PilotProcedureReport> pilotOutcomes(Principal principal) {
        return pilotOutcomes.pilotOutcomes(actor(principal));
    }

    @GetMapping("/cases/{id}/history")
    List<HistoryEntry> history(Principal principal, @PathVariable UUID id) {
        return service.applianceHistory(actor(principal), id);
    }

    @GetMapping("/cases/{id}")
    View view(Principal principal, @PathVariable UUID id) { return service.view(actor(principal), id); }

    @PutMapping("/cases/{id}")
    View edit(Principal principal, @PathVariable UUID id, @RequestParam long version, @Valid @RequestBody Intake intake) {
        return service.edit(actor(principal), id, version, intake);
    }

    private AccountDto.User actor(Principal principal) { return accounts.technician(principal.getName()); }
}
