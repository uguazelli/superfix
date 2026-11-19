package com.superfix.account;

import static com.superfix.config.ApiError.*;
import static com.superfix.account.AccountDto.*;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.*;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationRunner;
import org.springframework.context.annotation.Bean;
import org.springframework.data.domain.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.userdetails.*;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

@Slf4j
@Service
@RequiredArgsConstructor
public class AccountService implements UserDetailsService {
    private final AccountRepository accounts;
    private final CompanyRepository companies;
    private final PlanRepository plans;
    private final AccountMapper mapper;
    private final PasswordEncoder passwords;
    private final JdbcTemplate jdbc;
    private final TransactionTemplate transactions;

    @Override
    public UserDetails loadUserByUsername(String email) {
        Account account = accounts.findByEmail(normalize(email)).orElseThrow(() -> new UsernameNotFoundException("Unknown account"));
        return org.springframework.security.core.userdetails.User.withUsername(account.email)
                .password(account.passwordHash).roles(account.role.name()).disabled(!available(account)).build();
    }

    public AccountDto.User profile(String email) {
        var account = byEmail(email);
        if (!available(account)) throw forbidden("accountDisabled");
        return mapper.user(account);
    }

    public AccountDto.User actor(String email) {
        var user = profile(email);
        if (user.mustChangePassword()) throw forbidden("changePasswordRequired");
        return user;
    }

    @Transactional
    public AccountDto.User updateLocale(String email, String locale) {
        var account = byEmail(profile(email).email());
        account.locale = locale;
        return mapper.user(account);
    }

    public AccountDto.User technician(String email) {
        var user = actor(email);
        if (user.companyId() == null) throw forbidden("forbidden");
        return user;
    }

    void platform(AccountDto.User user) {
        if (user.role() != Role.PLATFORM_ADMIN) throw forbidden("forbidden");
    }

    @Transactional
    public AccountDto.User changePassword(String email, NewPassword input) {
        var account = byEmail(profile(email).email());
        if (!passwords.matches(input.currentPassword(), account.passwordHash)) throw bad("currentPassword");
        if (passwords.matches(input.password(), account.passwordHash)) throw bad("newPasswordMustDiffer");
        account.passwordHash = hash(input.password());
        account.mustChangePassword = false;
        revoke(account);
        audit(account.id, account.companyId, account.id, "PASSWORD_CHANGED");
        return mapper.user(account);
    }

    Page<Tier> tiers(AccountDto.User user, Pageable page) {
        platform(user);
        return plans.findAll(page).map(mapper::tier);
    }

    Page<Team> teams(AccountDto.User user, Pageable page) {
        platform(user);
        return companies.findAll(page).map(mapper::team);
    }

    Page<AccountDto.User> users(AccountDto.User user, UUID companyId, Pageable page) {
        requireTeamAdmin(user, companyId);
        return accounts.findByCompanyId(companyId, page).map(mapper::user);
    }

    public List<AccountDto.User> technicians(AccountDto.User user) {
        if (user.role() != Role.COMPANY_ADMIN) throw forbidden("forbidden");
        return accounts.findByCompanyIdAndActiveTrueOrderByName(user.companyId()).stream()
                .filter(account -> account.role == Role.TECHNICIAN)
                .map(mapper::user).toList();
    }

    public void requireActiveTechnician(UUID companyId, UUID technicianId) {
        accounts.findById(technicianId).filter(found -> companyId.equals(found.companyId)
                && found.active && found.role == Role.TECHNICIAN).orElseThrow(() -> bad("invalidAssignee"));
    }

    @Transactional
    public Tier createTier(AccountDto.User user, TierInput input) {
        platform(user);
        var plan = new Plan();
        plan.name = input.name().strip();
        plan.maxUsers = input.maxUsers();
        plan.monthlyAiLimit = input.monthlyAiLimit();
        plans.save(plan);
        audit(user.id(), null, plan.id, "PLAN_CREATED");
        return mapper.tier(plan);
    }

    @Transactional
    public Team saveTeam(AccountDto.User user, UUID id, TeamInput input) {
        platform(user);
        var company = id == null ? new Company() : companies.lock(id).orElseThrow(() -> missing());
        var plan = plans.findById(input.planId()).filter(p -> p.active).orElseThrow(() -> bad("invalidPlan"));
        if (id != null && accounts.countByCompanyIdAndActiveTrue(id) > plan.maxUsers) throw conflict("seatLimit");
        company.name = input.name().strip();
        company.planId = plan.id;
        company.active = input.active();
        companies.saveAndFlush(company);
        if (!company.active) {
            jdbc.update("delete from spring_session where principal_name in (select email from accounts where company_id = ?)", company.id);
        }
        audit(user.id(), company.id, company.id, id == null ? "COMPANY_CREATED" : "COMPANY_UPDATED");
        return mapper.team(company);
    }

    @Transactional
    public AccountDto.User createUser(AccountDto.User user, UUID companyId, NewUser input) {
        requireTeamAdmin(user, companyId);
        if (input.role() == Role.PLATFORM_ADMIN || (user.role() == Role.COMPANY_ADMIN && input.role() != Role.TECHNICIAN)) {
            throw forbidden("forbidden");
        }
        requireSeat(lockActiveCompany(companyId));
        var account = new Account();
        account.companyId = companyId;
        account.email = normalize(input.email());
        account.name = input.name().strip();
        account.role = input.role();
        account.passwordHash = hash(input.password());
        account.mustChangePassword = true;
        accounts.save(account);
        audit(user.id(), companyId, account.id, "USER_CREATED");
        return mapper.user(account);
    }

    @Transactional
    public AccountDto.User setActive(AccountDto.User user, UUID companyId, UUID id, boolean active) {
        requireTeamAdmin(user, companyId);
        var company = companies.lock(companyId).orElseThrow(() -> missing());
        var account = manageable(user, companyId, id);
        if (active && !account.active) {
            if (!company.active) throw forbidden("accountDisabled");
            requireSeat(company);
        }
        account.active = active;
        if (!active) revoke(account);
        audit(user.id(), companyId, id, active ? "USER_ENABLED" : "USER_DISABLED");
        return mapper.user(account);
    }

    @Transactional
    public void resetPassword(AccountDto.User user, UUID companyId, UUID id, String password) {
        requireTeamAdmin(user, companyId);
        companies.lock(companyId).orElseThrow(() -> missing());
        var account = manageable(user, companyId, id);
        account.passwordHash = hash(password);
        account.mustChangePassword = true;
        revoke(account);
        audit(user.id(), companyId, id, "PASSWORD_RESET");
    }

    public Integer lockAiLimit(UUID companyId) {
        var company = lockActiveCompany(companyId);
        return plans.findById(company.planId).filter(plan -> plan.active)
                .orElseThrow(() -> forbidden("invalidPlan")).monthlyAiLimit;
    }

    public void audit(UUID actor, UUID company, UUID subject, String action) {
        jdbc.update("insert into audit_events values (?, ?, ?, ?, ?, ?)",
                UUID.randomUUID(), actor, company, subject, action, java.sql.Timestamp.from(Instant.now()));
    }

    @Bean
    ApplicationRunner bootstrap(@Value("${superfix.bootstrap.email}") String email,
                               @Value("${superfix.bootstrap.password}") String password) {
        return args -> transactions.executeWithoutResult(status -> {
            jdbc.execute("select pg_advisory_xact_lock(735031)");
            if (accounts.existsByRole(Role.PLATFORM_ADMIN)) return;
            if (email.isBlank() || password.isBlank()) {
                log.warn("Set BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD to provision the first administrator.");
                return;
            }
            if (!normalize(email).matches("[^@\\s]+@[^@\\s]+\\.[^@\\s]+") || email.length() > 254) {
                throw new IllegalStateException("BOOTSTRAP_ADMIN_EMAIL must be a valid email address");
            }
            if (!validPassword(password)) {
                throw new IllegalStateException(
                        "BOOTSTRAP_ADMIN_PASSWORD must contain at least %d characters and at most 72 UTF-8 bytes"
                                .formatted(MIN_PASSWORD_LENGTH));
            }
            var admin = new Account();
            admin.email = normalize(email);
            admin.name = "Platform administrator";
            admin.role = Role.PLATFORM_ADMIN;
            admin.passwordHash = hash(password);
            admin.mustChangePassword = true;
            accounts.save(admin);
        });
    }

    private Account manageable(AccountDto.User user, UUID companyId, UUID id) {
        var account = accounts.findById(id).filter(a -> companyId.equals(a.companyId)).orElseThrow(() -> missing());
        if (id.equals(user.id()) || (user.role() == Role.COMPANY_ADMIN && account.role != Role.TECHNICIAN)) {
            throw forbidden("forbidden");
        }
        return account;
    }

    private void requireTeamAdmin(AccountDto.User user, UUID companyId) {
        if (user.role() == Role.PLATFORM_ADMIN) return;
        if (user.role() != Role.COMPANY_ADMIN || !companyId.equals(user.companyId())) throw forbidden("forbidden");
    }

    private Company lockActiveCompany(UUID companyId) {
        return companies.lock(companyId).filter(company -> company.active)
                .orElseThrow(() -> forbidden("accountDisabled"));
    }

    private void requireSeat(Company company) {
        var plan = plans.findById(company.planId).filter(p -> p.active).orElseThrow(() -> bad("invalidPlan"));
        if (accounts.countByCompanyIdAndActiveTrue(company.id) >= plan.maxUsers) throw conflict("seatLimit");
    }

    private boolean available(Account account) {
        return account.active && (account.companyId == null ||
                companies.findById(account.companyId).map(c -> c.active).orElse(false));
    }

    private Account byEmail(String email) {
        return accounts.findByEmail(normalize(email)).orElseThrow(() -> forbidden("accountDisabled"));
    }

    private void revoke(Account account) {
        jdbc.update("delete from spring_session where principal_name = ?", account.email);
    }

    private String hash(String password) {
        if (!validPassword(password)) throw bad("passwordLength");
        return passwords.encode(password);
    }

    private static boolean validPassword(String password) {
        return !password.isBlank() && password.length() >= MIN_PASSWORD_LENGTH
                && password.getBytes(StandardCharsets.UTF_8).length <= 72;
    }

    private static String normalize(String email) { return email.strip().toLowerCase(Locale.ROOT); }
}
