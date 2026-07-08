# Aperture attendance — universal image (Fly.io / Railway / Render / any VPS)
FROM node:24-alpine

WORKDIR /app

# Install production deps first for better layer caching
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# App source
COPY . .

ENV NODE_ENV=production
ENV PORT=3000
# Persist the SQLite DB (and auto-generated secret) on a mounted volume.
ENV APERTURE_DB=/data/aperture.db

EXPOSE 3000
CMD ["node", "server/index.js"]
