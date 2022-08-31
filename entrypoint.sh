#!/bin/sh

# notice: configure
holo config --fromFile $CONFIG_FILE

# notice: run the specified app
if [ $HOLO_CLI_MODE == "operator" ]
then
  holo $HOLO_CLI_MODE --mode auto --sync --healthCheck --unsafePassword $PASSWORD

elif [ $HOLO_CLI_MODE == "propagator" ]
then
  holo $HOLO_CLI_MODE --mode auto --sync --healthCheck --unsafePassword $PASSWORD

elif [ $HOLO_CLI_MODE == "indexer" ]
then
  holo $HOLO_CLI_MODE --host=$HOLO_INDEXER_HOST --healthCheck

else
  echo
  echo "-> ERROR...Hey, Should I run as operator, propagator, indexer or at least TERMINATOR?"
  echo
fi
