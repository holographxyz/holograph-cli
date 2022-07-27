#
# NOTICE: OPERATOR
#
# notice: use image from our own rgistry, cause Dockerhub imposes a pull limit and breaks the workflow
ARG AWS_ECR_URL=177635894328.dkr.ecr.us-west-2.amazonaws.com
ARG REPO_NAME=misc
FROM $AWS_ECR_URL/$REPO_NAME:node-16.16.0-alpine

RUN apk add git

WORKDIR /holo-cli

COPY package.json /holo-cli
COPY yarn.lock /holo-cli
COPY . /holo-cli

RUN yarn add https://github.com/ethereumjs/ethereumjs-abi.git
RUN yarn install --prefer-offline --silent --frozen-lockfile --non-interactive

RUN yarn build

RUN npm install -location=global ../holo-cli

## the main executable
#ENTRYPOINT ["/usr/local/bin/holo"]
## OR ENTRYPOINT ["holo"]
## a default command
#CMD ["help"]
CMD ["sh"]
#
# NOTICE: OPERATOR
#
