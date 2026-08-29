FROM node:22-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

# Both build sources ship in the image; $BUILD selects which one runs, so a
# rollback is a redeploy of the same image with a different build id — no rebuild.
COPY app-2026.08.20.js app-2026.08.27.js entrypoint.sh ./
RUN chmod +x entrypoint.sh

EXPOSE 3000

ENTRYPOINT ["./entrypoint.sh"]
