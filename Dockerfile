FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV MCP_TRANSPORT=http
ENV MCP_HOST=0.0.0.0
ENV PORT=3000
COPY --from=build /app/dist ./dist
COPY data ./data
EXPOSE 3000
CMD ["node", "dist/index.cjs"]
