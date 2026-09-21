FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --chown=node:node src ./src
USER node
ENV NODE_ENV=production PORT=8090 CAISSE_MODE=simulation
EXPOSE 8090
CMD ["node", "src/server.js"]
