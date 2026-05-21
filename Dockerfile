FROM node:24-alpine
WORKDIR /app
COPY package*.json tsconfig.json apis_config.json ./
RUN npm ci
COPY src/ ./src/
RUN npx esbuild src/mock-server.ts --bundle --platform=node --target=node16 --outfile=dist/mock-server.js
EXPOSE 8080
CMD ["node", "dist/mock-server.js"]
