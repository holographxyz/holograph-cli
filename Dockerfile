FROM node:16-alpine

RUN apk add git

WORKDIR /holo-cli

COPY package.json .
COPY yarn.lock .

RUN yarn add https://github.com/ethereumjs/ethereumjs-abi.git
RUN yarn install --prefer-offline --silent --frozen-lockfile --non-interactive

COPY . .

RUN yarn build

RUN npm install -location=global ../holo-cli

ENTRYPOINT ["holo"]
