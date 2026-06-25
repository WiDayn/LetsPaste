FROM golang:1.26-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o /out/letspaste ./cmd/server

FROM alpine:3.22
WORKDIR /app
RUN adduser -D -H app && mkdir -p /data && chown -R app:app /data
USER app
COPY --from=build /out/letspaste /app/letspaste
ENV DB_PATH=/data/letspaste.db
EXPOSE 8080
CMD ["/app/letspaste"]
