FROM node:22-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY app.js ./

EXPOSE 3000

# Single process on purpose: one connection pool, so widening the pool is the
# only lever. Horizontal scaling would add more pools and mask the cause.
CMD ["node", "app.js"]
