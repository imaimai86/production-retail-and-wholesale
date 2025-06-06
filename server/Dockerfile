FROM node:18-alpine
WORKDIR /app
COPY package.json package-lock.json ./
# Install all dependencies including devDependencies so the image
# can be used to run tests in CI
RUN npm ci
COPY . .
EXPOSE 3000
CMD ["npm", "start"]
