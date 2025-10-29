# Production Dockerfile for dashboard (Bun + static build served by nginx)
# Multi-stage: build with Bun, serve static files with nginx

FROM oven/bun:latest AS builder
WORKDIR /app

# Copy package manifest(s) first for better caching
COPY package.json .
COPY bunfig.toml .

# Copy source
COPY . .

# Install dependencies and build the static site to /app/dist
RUN bun install
RUN bun run build

# Stage: runtime (nginx)
FROM nginx:alpine AS runtime
COPY --from=builder /app/dist /usr/share/nginx/html

# Optional: copy a custom nginx.conf if you have one (uncomment if needed)
# COPY nginx.conf /etc/nginx/nginx.conf

EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 CMD wget -q --spider http://localhost:80 || exit 1

CMD ["nginx", "-g", "daemon off;"]
