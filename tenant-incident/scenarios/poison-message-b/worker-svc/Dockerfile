FROM node:22-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY worker.js ./

EXPOSE 9000

# Single worker on purpose: one ordered consumer of the queue, so the only lever
# on a poisoned head is to quarantine it. A second worker would wedge on the same
# head and mask the cause.
CMD ["node", "worker.js"]
