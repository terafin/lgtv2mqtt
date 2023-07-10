FROM node:16-alpine

RUN mkdir -p /usr/node_app
COPY . /usr/node_app
WORKDIR /usr/node_app
RUN apk add --no-cache git python3 make
RUN npm install --production

CMD ["npm", "start"]
