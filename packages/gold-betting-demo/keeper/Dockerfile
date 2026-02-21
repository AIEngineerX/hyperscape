FROM oven/bun:1.3.8

WORKDIR /app

COPY package.json ./
RUN bun install --production

COPY tsconfig.json ./tsconfig.json
COPY src ./src

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

CMD ["bun", "--bun", "src/service.ts"]
