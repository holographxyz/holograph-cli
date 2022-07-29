#!/bin/sh

holo config --fromFile config.json
holo operator --mode auto --healthCheck #TODO --password asdf
sleep infinity
