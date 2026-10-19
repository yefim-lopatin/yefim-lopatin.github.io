FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && mkdir /data && chown node:node /data
COPY *.mjs ./
USER node
ENV DATA_DIR=/data
CMD ["node", "server.mjs"]
