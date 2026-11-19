FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /app
COPY pom.xml .
RUN mvn -B dependency:go-offline
COPY src src
RUN mvn -B package
FROM eclipse-temurin:21-jre-jammy
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/* \
    && useradd --uid 10001 --no-create-home superfix \
    && install -d -o superfix -g superfix /data/photos
WORKDIR /app
COPY --from=build /app/target/superfix-0.1.0.jar app.jar
USER superfix
EXPOSE 8080
ENTRYPOINT ["java", "-XX:MaxRAMPercentage=65", "-jar", "app.jar"]
