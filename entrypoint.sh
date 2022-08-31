#!/bin/sh

#
holo config --fromFile $CONFIG_FILE

# notice: sample
#./bin/dev operator   --mode auto --healthCheck --sync --unsafePassword [password]
#./bin/dev propagator --mode auto --healthCheck --sync --unsafePassword [password]
#./bin/dev indexer    --host=https://develop.cxipchain.xyz --healthCheck

if [ $HOLO_CLI_MODE == "operator" ]
then
  $HOLO_CLI_MODE --mode auto --sync --healthCheck --unsafePassword $PASSWORD

elif [ $HOLO_CLI_MODE == "propagator" ]
then
  $HOLO_CLI_MODE --mode auto --sync --healthCheck --unsafePassword $PASSWORD

elif [ $HOLO_CLI_MODE == "indexer" ]
then
  $HOLO_CLI_MODE --host=$HOLO_INDEXER_HOST --healthCheck

else
  echo
  echo "-> ERROR...Hey, Should I run as operator, propagator, indexer or at least TERMINATOR?"
  echo
fi
