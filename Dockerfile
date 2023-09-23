FROM node:lts-alpine
WORKDIR /app
COPY package.json ./
COPY package-lock.json ./
COPY tsconfig.json ./
COPY ./prisma ./prisma
RUN npm ci
RUN npx prisma generate
COPY . ./
CMD ["tail", "-f", "/dev/null"]