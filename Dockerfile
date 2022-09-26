ARG AWS_ECR_URL=default-value-in-dockerfile
ARG REPO_NAME=misc

FROM $AWS_ECR_URL/$REPO_NAME:node-18.9.0

#RUN apk update && apk add git curl jq
#RUN apk add --update python3 make g++ && rm -rf /var/cache/apk/*
RUN apt-get update && apt-get install -y git curl jq
RUN apt install -y python3.9

WORKDIR /holo-cli

COPY package.json /holo-cli
COPY yarn.lock /holo-cli
COPY . /holo-cli

RUN yarn install --prefer-offline --silent --frozen-lockfile --non-interactive

RUN yarn build

RUN npm install -location=global ../holo-cli

ENV CONFIG_FILE=a-super-config-file.json
ENV PASSWORD=a-super-secret-password
ENV HOLO_CLI_MODE=TeRmInAtOr
ENV HOLO_INDEXER_HOST=ThE_FuTuRe

# we use liveness/readiness probes in k8s
HEALTHCHECK none

EXPOSE 6000

RUN chmod 755 /holo-cli/entrypoint.sh
# notice: The ENTRYPOINT specifies a command that will always be executed when the container starts.
ENTRYPOINT ["/holo-cli/entrypoint.sh"]
# notice: The CMD specifies arguments that will be fed to the ENTRYPOINT
# https://docs.docker.com/engine/reference/builder/#understand-how-cmd-and-entrypoint-interact
