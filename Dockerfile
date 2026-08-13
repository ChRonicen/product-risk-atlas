FROM node:20-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY public ./public
COPY scripts ./scripts
COPY server.mjs ./server.mjs

ENV NODE_ENV=production
ENV PORT=4173

EXPOSE 4173

CMD ["node", "server.mjs"]
