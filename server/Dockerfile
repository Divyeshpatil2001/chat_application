# Node 22.5+ is required for the built-in node:sqlite module.
FROM node:25-alpine
WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

ENV PORT=4000 DATA_DIR=/data
EXPOSE 4000
CMD ["node", "index.js"]
