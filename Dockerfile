# Qodi - Docker Image
# Build TypeScript ahead of time and run the compiled output with Node.js

FROM node:24.22.1-slim AS base

# Install runtime dependencies used by the app and healthcheck
RUN apt-get update && apt-get install -y \
  openssl \
  ca-certificates \
  curl \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

FROM base AS builder

# Copy package files first for better Docker layer caching
COPY package*.json ./

# Install all dependencies required for the build
RUN npm ci

# Copy source code and configuration files, then build
COPY . .
RUN npm run build

FROM base AS runtime

# Copy package files first for better Docker layer caching
COPY package*.json ./

# Install only production dependencies for runtime
RUN npm ci --omit=dev

# Copy the built application and required runtime assets
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/api ./api

# Expose the port the app runs on
EXPOSE 8080

# Change ownership of the app directory
RUN chown -R node:node /app
USER node

# Health check to verify the application is running
HEALTHCHECK --interval=30s --timeout=10s --retries=3 --start-period=40s \
  CMD curl -f http://localhost:8080/health || exit 1

# Start the compiled application
CMD ["node", "dist/src/index.js"]
