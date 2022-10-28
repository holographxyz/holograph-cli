#!/bin/bash

echo "-- The env vars are below... --"
# notice: set the env vars
if [[ $ENABLE_DEBUG == 'true' ]]
then
  export ENABLE_DEBUG='env DEBUG=\*'
  echo "ENABLE_DEBUG=${ENABLE_DEBUG}"
else
  export ENABLE_DEBUG=""
  echo "ENABLE_DEBUG=${ENABLE_DEBUG}"
fi

if [[ $ENABLE_SYNC == 'true' ]]
then
  export ENABLE_SYNC="--sync"
  echo "ENABLE_SYNC=${ENABLE_SYNC}"
else
  export ENABLE_SYNC=""
  echo "ENABLE_SYNC=${ENABLE_SYNC}"
fi

if [[ $HEALTHCHECK == 'true' ]]
then
  export HEALTHCHECK="--healthCheck"
  echo "HEALTHCHECK=${HEALTHCHECK}"
else
  export HEALTHCHECK=""
  echo "HEALTHCHECK=${HEALTHCHECK}"
fi

# notice: configure
holograph config --fromFile $CONFIG_FILE

# notice: run the specified app
if [[ $HOLO_CLI_CMD == "operator" ]]
then
  eval $ENABLE_DEBUG ABI_ENVIRONMENT=$ABI_ENVIRONMENT holograph $HOLO_CLI_CMD --networks $NETWORK --mode $MODE $ENABLE_SYNC $HEALTHCHECK --unsafePassword $PASSWORD

elif [[ $HOLO_CLI_CMD == "propagator" ]]
then
  eval $ENABLE_DEBUG ABI_ENVIRONMENT=$ABI_ENVIRONMENT holograph $HOLO_CLI_CMD --mode $MODE $ENABLE_SYNC $HEALTHCHECK --unsafePassword $PASSWORD

elif [[ $HOLO_CLI_CMD == "indexer" ]]
then
  eval $ENABLE_DEBUG ABI_ENVIRONMENT=$ABI_ENVIRONMENT holograph $HOLO_CLI_CMD --networks $NETWORK --mode $MODE --host=$HOLO_INDEXER_HOST $HEALTHCHECK

else
  echo
  echo "-> ERROR...Hey, Should I run as operator, propagator, indexer or at least TERMINATOR?"
  echo
fi
