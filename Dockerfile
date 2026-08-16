# The contract's proving keys are large and are produced by the Compact
# compiler, which is not available in this image — so `npm run compact` must
# have been run on the host before building. contract/src/managed is copied in.

FROM node:22-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
COPY contract/package.json ./contract/
COPY server/package.json ./server/
COPY web/package.json ./web/
RUN npm install --omit=dev --no-audit --no-fund || npm install --no-audit --no-fund

COPY contract ./contract
COPY server ./server
COPY web ./web

# The frontend is served by the backend, so it must be built into web/dist.
RUN npm install --no-audit --no-fund \
  && npm run build --workspace @canopy/web \
  && npm run build --workspace @canopy/contract

ENV NODE_ENV=production
ENV PORT=3001
EXPOSE 3001

CMD ["npm", "start", "--workspace", "@canopy/server"]
