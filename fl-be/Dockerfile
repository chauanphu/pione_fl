# Production Dockerfile for fl-be (Node.js / Express)

FROM node:20-alpine
WORKDIR /usr/src/app

# Copy package manifests first to leverage Docker layer caching
COPY package.json package-lock.json* ./

# Install production dependencies only
RUN npm install --production --no-audit --no-fund

# Copy app source
COPY . .

ENV NODE_ENV=production

# The backend listens on port 3001 by default in this repo
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 CMD wget -q --spider http://localhost:3001/ || exit 1

CMD ["node", "server.js"]
