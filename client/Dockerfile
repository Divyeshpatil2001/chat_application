# Dev image: runs the Vite dev server with hot reload (source is bind-mounted by compose).
FROM node:25-alpine
WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 5173
CMD ["npm", "run", "dev", "--", "--host"]
