package com.superfix.config;

import java.util.Map;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.*;
import org.springframework.orm.ObjectOptimisticLockingFailureException;
import org.springframework.web.ErrorResponseException;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MaxUploadSizeExceededException;

public class ApiError extends ErrorResponseException {
    public ApiError(HttpStatus status, String code) {
        super(status, ProblemDetail.forStatusAndDetail(status, code), null);
    }

    public static ApiError bad(String code) { return new ApiError(HttpStatus.BAD_REQUEST, code); }
    public static ApiError conflict(String code) { return new ApiError(HttpStatus.CONFLICT, code); }
    public static ApiError missing() { return new ApiError(HttpStatus.NOT_FOUND, "notFound"); }
    public static ApiError forbidden(String code) { return new ApiError(HttpStatus.FORBIDDEN, code); }

    @RestControllerAdvice
    static class Handler {
        @ExceptionHandler(DataIntegrityViolationException.class)
        ResponseEntity<Map<String,String>> duplicate() {
            return ResponseEntity.status(409).body(Map.of("detail", "dataConflict"));
        }

        @ExceptionHandler(ObjectOptimisticLockingFailureException.class)
        ResponseEntity<Map<String,String>> stale() {
            return ResponseEntity.status(409).body(Map.of("detail", "staleCase"));
        }

        @ExceptionHandler(MaxUploadSizeExceededException.class)
        ResponseEntity<Map<String,String>> oversized() {
            return ResponseEntity.status(413).body(Map.of("detail", "photoLimit"));
        }
    }
}
