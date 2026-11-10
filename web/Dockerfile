FROM node:22-alpine

ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    HOME=/tmp

WORKDIR /app

COPY package.json ./
COPY server ./server
COPY public ./public

RUN chown -R node:node /app

USER node

EXPOSE 3000

CMD ["node", "server/index.js"]
