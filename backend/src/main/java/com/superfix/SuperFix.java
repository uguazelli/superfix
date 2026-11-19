package com.superfix;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

@EnableScheduling
@SpringBootApplication
public class SuperFix {
    public static void main(String[] args) {
        SpringApplication.run(SuperFix.class, args);
    }
}
