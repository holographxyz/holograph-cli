#!/bin/bash

# notice: set the env vars
if [[ $ENABLE_DEBUG == 'true' ]]
then
  export ENABLE_DEBUG='env DEBUG=\*'
  echo ${ENABLE_DEBUG}
else
  export ENABLE_DEBUG=""
fi

if [[ $ENABLE_SYNC == 'true' ]]
then
  export ENABLE_SYNC="--sync"
  echo ${ENABLE_SYNC}
else
  export ENABLE_SYNC=""
fi

if [[ $HEALTHCHECK == 'true' ]]
then
  export HEALTHCHECK="--healthCheck"
  echo ${HEALTHCHECK}
else
  export HEALTHCHECK=""
fi

# notice: configure
holo config --fromFile $CONFIG_FILE

# notice: run the specified app
if [[ $HOLO_CLI_CMD == "operator" ]]
then
  eval $ENABLE_DEBUG ABI_ENVIRONMENT=${ABI_ENVIRONMENT} holo ${HOLO_CLI_CMD} --networks ${NETWORK} --mode ${MODE} ${ENABLE_SYNC} ${HEALTHCHECK} --unsafePassword ${PASSWORD}

elif [[ $HOLO_CLI_CMD == "propagator" ]]
then
  eval env $ENABLE_DEBUG ABI_ENVIRONMENT=$ABI_ENVIRONMENT holo $HOLO_CLI_CMD --mode $MODE $ENABLE_SYNC $HEALTHCHECK --unsafePassword $PASSWORD

elif [[ $HOLO_CLI_CMD == "indexer" ]]
then
  eval env $ENABLE_DEBUG ABI_ENVIRONMENT=$ABI_ENVIRONMENT holo $HOLO_CLI_CMD --networks $NETWORK --mode $MODE --host=$HOLO_INDEXER_HOST $HEALTHCHECK

else
  echo
  echo "-> ERROR...Hey, Should I run as operator, propagator, indexer or at least TERMINATOR?"
  echo
fi
