FROM node:18
WORKDIR /app
COPY package.json ./
COPY package-lock.json ./
# Install all dependencies so test tools like Jest are available
RUN npm ci
COPY . .
CMD ["npm", "run", "start"]
