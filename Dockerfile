ARG AWS_ECR_URL=default-value-in-dockerfile
ARG REPO_NAME=misc

FROM $AWS_ECR_URL/$REPO_NAME:node-18.9.0

STOPSIGNAL SIGINT

#RUN apk update && apk add git curl jq
#RUN apk add --update python3 make g++ && rm -rf /var/cache/apk/*
RUN apt-get update && apt-get install -y git curl jq nano net-tools
RUN apt install -y python3.9

WORKDIR /holograph-cli

COPY package.json /holograph-cli
COPY yarn.lock /holograph-cli
COPY . /holograph-cli

RUN yarn install --prefer-offline --silent --frozen-lockfile --non-interactive

RUN yarn build

RUN npm install -location=global ../holograph-cli

# experimental / develop / testnet / mainnet
ENV HOLOGRAPH_ENVIRONMENT=a-super-fancy-environment
ENV CONFIG_FILE=a-super-config-file.json
ENV PASSWORD=a-super-secret-password
ENV HOLOGRAPH_CLI_CMD=TeRmInAtOr
ENV HOLOGRAPH_INDEXER_HOST=ThE_FuTuRe
#
ENV ENABLE_DEBUG=defaul-value
ENV ENABLE_SYNC=defaul-value
ENV HEALTHCHECK=defaul-value
ENV MODE=defaul-value
#
ENV ENABLE_UNSAFE=defaul-value

# we use liveness/readiness probes in k8s
HEALTHCHECK none

EXPOSE 6000

RUN chmod 755 /holograph-cli/entrypoint.sh
# notice: The ENTRYPOINT specifies a command that will always be executed when the container starts.
#ENTRYPOINT ["/holograph-cli/entrypoint.sh"]
# notice: The CMD specifies arguments that will be fed to the ENTRYPOINT
# https://docs.docker.com/engine/reference/builder/#understand-how-cmd-and-entrypoint-interact


# Add Tini
ENV TINI_VERSION v0.19.0
ADD https://github.com/krallin/tini/releases/download/${TINI_VERSION}/tini /tini
RUN chmod +x /tini
ENTRYPOINT ["/tini", "--"]

# Run your program under Tini
CMD ["/holograph-cli/entrypoint.sh"]


