FROM node:20-alpine AS base

WORKDIR /app

# Instalar dependencias necesarias para compilación
COPY package.json ./
RUN npm install --legacy-peer-deps

# Copiar código fuente y compilar Next.js App Router
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

EXPOSE 8540
ENV PORT=8540
ENV HOSTNAME="0.0.0.0"

CMD ["npx", "next", "start", "-p", "8540"]
