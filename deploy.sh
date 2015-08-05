#!/usr/bin/env bash

set -e

TIMESTAMP=$(date +%Y%m%d_%H%M%S)

mkdir -p ${ROOT_CONNECTOR_DIR}/hoist-connector-xero/${TIMESTAMP}

cp -r . ${ROOT_CONNECTOR_DIR}/hoist-connector-xero/${TIMESTAMP}

rm -f ${ROOT_CONNECTOR_DIR}/hoist-connector-xero/current

ln -s ${TIMESTAMP} ${ROOT_CONNECTOR_DIR}/hoist-connector-xero/current


(ls -t ${ROOT_CONNECTOR_DIR}/hoist-connector-xero/|head -n 5;ls ${ROOT_CONNECTOR_DIR}/hoist-connector-xero/)|sort|uniq -u|xargs -I '{}' rm -r ${ROOT_CONNECTOR_DIR}/hoist-connector-xero/'{}'
