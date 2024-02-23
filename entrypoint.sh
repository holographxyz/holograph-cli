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

if [[ $ENABLE_REPLAY == "undefined" ]]
then
  export ENABLE_REPLAY=""
  echo "ENABLE_REPLAY=${ENABLE_REPLAY}"
else
  export ENABLE_REPLAY="--replay ${ENABLE_REPLAY}"
  echo "ENABLE_REPLAY=${ENABLE_REPLAY}"
fi

if [[ $ENABLE_PROCESS_BLOCK_RANGE == 'true' ]]
then
  export ENABLE_PROCESS_BLOCK_RANGE="--process-block-range"
  echo "ENABLE_PROCESS_BLOCK_RANGE=${ENABLE_PROCESS_BLOCK_RANGE}"
else
  export ENABLE_PROCESS_BLOCK_RANGE=""
  echo "ENABLE_PROCESS_BLOCK_RANGE=${ENABLE_PROCESS_BLOCK_RANGE}"
fi

if [[ $ENABLE_UNSAFE == 'true' ]] && [[ $HOLOGRAPH_ENVIRONMENT == "mainnet" ]]
then
  export ENABLE_UNSAFE='--unsafe'
  echo "ENABLE_UNSAFE=${ENABLE_UNSAFE}"
else
  export ENABLE_UNSAFE=""
  echo "ENABLE_UNSAFE=${ENABLE_UNSAFE}"
fi
#
echo "UPDATE_BLOCK_HEIGHT=${UPDATE_BLOCK_HEIGHT}"
echo "HOLOGRAPH_ENVIRONMENT=${HOLOGRAPH_ENVIRONMENT}"
echo "NETWORK=${NETWORK}"
echo "MODE=${MODE}"

# notice: configure
holograph config --fromFile $CONFIG_FILE

# notice: run the specified app
if [[ $HOLO_CLI_CMD == "operator" ]]
then
  eval $ENABLE_DEBUG holograph $HOLO_CLI_CMD --env $HOLOGRAPH_ENVIRONMENT --networks $NETWORK --host=$HOLO_OPERATOR_HOST --mode $MODE $ENABLE_SYNC $HEALTHCHECK --unsafePassword $PASSWORD --update-block-height $UPDATE_BLOCK_HEIGHT $ENABLE_REPLAY $ENABLE_PROCESS_BLOCK_RANGE $ENABLE_UNSAFE

elif [[ $HOLO_CLI_CMD == "indexer" ]]
then
  eval $ENABLE_DEBUG holograph $HOLO_CLI_CMD --env $HOLOGRAPH_ENVIRONMENT --networks $NETWORK --host=$HOLO_INDEXER_HOST $HEALTHCHECK $ENABLE_SYNC --update-block-height $UPDATE_BLOCK_HEIGHT $ENABLE_REPLAY $ENABLE_PROCESS_BLOCK_RANGE $ENABLE_UNSAFE

else
  echo
  echo "-> ERROR...Hey, Should I run as operator, indexer or at least TERMINATOR?"
  echo
fi
