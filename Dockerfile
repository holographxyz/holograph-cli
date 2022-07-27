FROM node:16.16.0-alpine

RUN apk add git

WORKDIR /holo-cli

COPY package.json .
COPY yarn.lock .
COPY . .

RUN yarn add https://github.com/ethereumjs/ethereumjs-abi.git
RUN yarn install --prefer-offline --silent --frozen-lockfile --non-interactive

RUN yarn build

RUN npm install -location=global ../holo-cli

# the main executable
ENTRYPOINT ["holo"]
# a default command
CMD ["help"]
