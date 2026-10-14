FROM node:20-alpine
WORKDIR /repo
COPY shared/package*.json shared/
COPY back-service/package*.json back-service/
WORKDIR /repo/back-service
ENV MONGOMS_DISABLE_POSTINSTALL=1
RUN npm install
COPY shared/ /repo/shared/
COPY back-service/ ./
RUN npm run build
CMD ["npm", "start"]
