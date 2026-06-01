# Railway/Docker image for the AI bot example (examples/nextjs-velt-ai-bot).
#
# This is a monorepo: the example depends on the workspace package
# @velt-js/chat-sdk-adapter, which must be built BEFORE the example. The build
# order below makes that explicit.
#
# To deploy the NON-AI bot instead, change the two `-w nextjs-velt-ai-bot`
# references to `-w nextjs-velt-bot`.

FROM node:20-slim AS builder
WORKDIR /app

# Install all workspace dependencies from the committed lockfile.
COPY . .
RUN npm ci

# Build the adapter first, then the Next.js example that consumes it.
RUN npm run build -w @velt-js/chat-sdk-adapter \
 && npm run build -w nextjs-velt-ai-bot

# --- runtime ---
ENV NODE_ENV=production
# Railway injects PORT; `next start` binds to it automatically on 0.0.0.0.
CMD ["npm", "run", "start", "-w", "nextjs-velt-ai-bot"]
