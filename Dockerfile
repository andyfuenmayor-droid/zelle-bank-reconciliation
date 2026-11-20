FROM node:20-alpine AS base

WORKDIR /app

# Instalar dependencias usando lockfile para reproducibilidad
COPY package.json package-lock.json ./
RUN npm ci --legacy-peer-deps

# Copiar código fuente y compilar Next.js App Router
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build && chown -R node:node /app

USER node

EXPOSE 8550
ENV PORT=8550
ENV HOSTNAME="0.0.0.0"

CMD ["npx", "next", "start", "-p", "8550"]
