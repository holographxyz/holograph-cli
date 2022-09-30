#!/bin/bash

# notice: set the env vars
if [[ $ENABLE_DEBUG == "true" ]]
then
  ENABLE_DEBUG="DEBUG=\*"
fi

if [[ $ENABLE_SYNC == "true" ]]
then
  ENABLE_SYNC="--sync"
fi

if [[ $HEALTHCHECK == "true" ]]
then
  HEALTHCHECK="--healthCheck"
fi

# notice: configure
holo config --fromFile $CONFIG_FILE

# notice: run the specified app
if [[ $HOLO_CLI_CMD == "operator" ]]
then
  eval env $ENABLE_DEBUG ABI_ENVIRONMENT=$ABI_ENVIRONMENT holo $HOLO_CLI_CMD --networks $NETWORK --mode $MODE $ENABLE_SYNC $HEALTHCHECK --unsafePassword $PASSWORD

elif [[ $HOLO_CLI_CMD == "propagator" ]]
then
  eval env $ENABLE_DEBUG ABI_ENVIRONMENT=$ABI_ENVIRONMENT holo $HOLO_CLI_CMD --mode $MODE $ENABLE_SYNC $HEALTHCHECK --unsafePassword $PASSWORD

elif [[ $HOLO_CLI_CMD == "indexer" ]]
then
  eval env $ENABLE_DEBUG ABI_ENVIRONMENT=$ABI_ENVIRONMENT holo $HOLO_CLI_CMD --host=$HOLO_INDEXER_HOST $HEALTHCHECK

else
  echo
  echo "-> ERROR...Hey, Should I run as operator, propagator, indexer or at least TERMINATOR?"
  echo
fi
