FROM node:22-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
# lock file must match package.json; `npm install` resolves drift (e.g. transitive yaml) where `npm ci` fails
RUN npm install

COPY . .

ARG VITE_API_URL=http://localhost:8080
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build

FROM node:22-alpine

COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["npx", "serve", "-s", "/usr/share/nginx/html", "-l", "80"]
