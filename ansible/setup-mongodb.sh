#!/usr/bin/env bash
set -euo pipefail

INVENTORY_FILE=""

if [[ -f ./live-inventory.ini ]]; then
	INVENTORY_FILE="./live-inventory.ini"
elif [[ -f ./inventory.ini ]]; then
	INVENTORY_FILE="./inventory.ini"
else
	echo "No inventory file found. Generate ansible/live-inventory.ini via make create-inventory or provide ansible/inventory.ini."
	exit 1
fi

ansible-playbook -i "$INVENTORY_FILE" setup-mongodb-replica-set.yml
