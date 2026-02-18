FROM node:20-slim

WORKDIR /app

# Build from repository root for Cloud Build triggers that expect ./Dockerfile
COPY inventory-manager/package*.json ./
RUN npm install --omit=dev

COPY inventory-manager/ ./

ENV PORT=8080
EXPOSE 8080

CMD ["npm", "start"]
