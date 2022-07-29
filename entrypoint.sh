#!/bin/sh

#
holo config --fromFile $CONFIG_FILE

#
holo operator --mode auto --sync --healthCheck --unsafePassword $PASSWORD

