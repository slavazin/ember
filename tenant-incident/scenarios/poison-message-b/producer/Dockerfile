FROM node:22-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY producer.js ./

CMD ["node", "producer.js"]
