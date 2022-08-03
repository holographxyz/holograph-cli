# notice: use image from our own rgistry, cause Dockerhub imposes a pull limit and breaks the workflow
ARG AWS_ECR_URL=177635894328.dkr.ecr.us-west-2.amazonaws.com
ARG REPO_NAME=misc
#FROM $AWS_ECR_URL/$REPO_NAME:node-16.16.0-alpine
#FROM $AWS_ECR_URL/$REPO_NAME:node-18.4.0-alpine
FROM node:18.4.0-alpine

RUN apk update && apk add git curl

WORKDIR /holo-cli

COPY package.json /holo-cli
COPY yarn.lock /holo-cli
COPY . /holo-cli

RUN yarn add https://github.com/ethereumjs/ethereumjs-abi.git
RUN yarn install --prefer-offline --silent --frozen-lockfile --non-interactive

RUN yarn build

RUN npm install -location=global ../holo-cli

ENV CONFIG_FILE=a-super-config-file.json
ENV PASSWORD=a-super-secret-password

ENV HOLO_CLI_MODE=TeRmInAtOr
ENV HOLO_INDEXER_HOST=ThE_FuTuRe

EXPOSE 6000

RUN chmod 755 /holo-cli/entrypoint.sh
# notice: The ENTRYPOINT specifies a command that will always be executed when the container starts.
ENTRYPOINT ["/holo-cli/entrypoint.sh"]
# notice: The CMD specifies arguments that will be fed to the ENTRYPOINT
# https://docs.docker.com/engine/reference/builder/#understand-how-cmd-and-entrypoint-interact
