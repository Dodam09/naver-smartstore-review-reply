FROM node:20-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev

COPY server/ .

ENV NODE_ENV=production
ENV DATA_DIR=/data
ENV PORT=8787

EXPOSE 8787

CMD ["npm", "start"]
