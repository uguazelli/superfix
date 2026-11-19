package com.superfix.config;

import java.time.*;
import java.util.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.*;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;
import org.springframework.session.web.http.DefaultCookieSerializer;
import org.springframework.web.filter.OncePerRequestFilter;

@Configuration
public class SecurityConfig {
    @Bean
    PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder(12);
    }

    @Bean
    DefaultCookieSerializer cookieSerializer(@Value("${server.servlet.session.cookie.secure}") boolean secure) {
        var serializer = new DefaultCookieSerializer();
        serializer.setUseSecureCookie(secure);
        serializer.setUseHttpOnlyCookie(true);
        serializer.setSameSite("Lax");
        serializer.setCookiePath("/");
        return serializer;
    }

    @Bean
    SecurityFilterChain security(HttpSecurity http) throws Exception {
        var attempts = new LoginAttempts();
        var throttle = new OncePerRequestFilter() {
            @Override
            protected void doFilterInternal(jakarta.servlet.http.HttpServletRequest request,
                    jakarta.servlet.http.HttpServletResponse response, jakarta.servlet.FilterChain chain)
                    throws jakarta.servlet.ServletException, java.io.IOException {
                if (request.getMethod().equals("POST") && request.getServletPath().equals("/api/v1/auth/login")) {
                    String address = Optional.ofNullable(request.getHeader("X-Real-IP")).orElse(request.getRemoteAddr());
                    if (!attempts.allow(address)) {
                        response.setHeader("Retry-After", "60");
                        response.sendError(429);
                        return;
                    }
                }
                chain.doFilter(request, response);
            }
        };
        return http
                .authorizeHttpRequests(auth -> auth
                        .requestMatchers("/actuator/health", "/api/v1/auth/csrf", "/error").permitAll()
                        .requestMatchers(HttpMethod.POST, "/api/v1/auth/login").permitAll()
                        .anyRequest().authenticated())
                .addFilterBefore(throttle, UsernamePasswordAuthenticationFilter.class)
                .requestCache(cache -> cache.disable())
                .exceptionHandling(errors -> errors.authenticationEntryPoint((q, r, e) -> r.sendError(401)))
                .formLogin(login -> login.loginProcessingUrl("/api/v1/auth/login").usernameParameter("email")
                        .successHandler((q, r, a) -> r.setStatus(204))
                        .failureHandler((q, r, e) -> r.sendError(401)))
                .logout(logout -> logout.logoutUrl("/api/v1/auth/logout")
                        .deleteCookies("SESSION").logoutSuccessHandler((q, r, a) -> r.setStatus(204)))
                .build();
    }

    private static class LoginAttempts {
        private final Map<String, Window> windows = new HashMap<>();
        private record Window(Instant expires, int count) {}

        synchronized boolean allow(String address) {
            Instant now = Instant.now();
            windows.values().removeIf(window -> !window.expires().isAfter(now));
            Window window = windows.get(address);
            if (window == null) {
                if (windows.size() >= 10_000) return false;
                windows.put(address, new Window(now.plusSeconds(60), 1));
                return true;
            }
            if (window.count() >= 20) return false;
            windows.put(address, new Window(window.expires(), window.count() + 1));
            return true;
        }
    }
}
