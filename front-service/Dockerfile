FROM node:20-alpine
WORKDIR /repo
COPY shared/package*.json shared/
COPY front-service/package*.json front-service/
WORKDIR /repo/front-service
RUN npm install
COPY shared/ /repo/shared/
COPY front-service/ ./
RUN npm run build
CMD ["npm", "start"]
