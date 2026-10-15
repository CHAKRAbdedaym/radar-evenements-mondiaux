# --- build stage: compile the React app ---
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

# --- runtime stage: nginx serves dist/ and proxies /api ---
FROM nginx:1.27-alpine
RUN rm -f /etc/nginx/conf.d/default.conf
COPY nginx.conf /etc/nginx/conf.d/radar.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 5173
HEALTHCHECK --interval=15s --timeout=4s --retries=3 CMD wget -q -O /dev/null http://127.0.0.1:5173/ || exit 1
CMD ["nginx", "-g", "daemon off;"]
