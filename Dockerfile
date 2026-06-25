FROM node:22-alpine AS frontend-build
WORKDIR /src/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM golang:1.26-alpine AS backend-build
WORKDIR /src/backend
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/ ./
RUN CGO_ENABLED=0 go build -o /out/letspaste ./cmd/server

FROM alpine:3.22
WORKDIR /app
RUN adduser -D -H app && mkdir -p /data /app/public && chown -R app:app /data /app
COPY --from=backend-build /out/letspaste /app/letspaste
COPY --from=frontend-build /src/frontend/dist /app/public
USER app
ENV PORT=8080
ENV DB_PATH=/data/letspaste.db
ENV STATIC_DIR=/app/public
EXPOSE 8080
CMD ["/app/letspaste"]
