# VisionSync Ansible Playbooks

Ansible runs **on the bastion host** (not your local machine) because:

- Ansible requires Linux (won't run on Windows)
- MongoDB and Redis are in private subnets, reachable only from within the VPC
- The bastion is the natural control node

## Directory structure

```
ansible/
  ansible.cfg              # Default inventory = hosts.ini, pipelining on
  mongodb-replica-setup.yml # Install MongoDB 7.0, init replica set rs0
  redis-docker-setup.yml   # Deploy Redis 7 in Docker container
  site.yml                 # Orchestrate both playbooks
  templates/
    mongod.conf.j2         # MongoDB config (replica set rs0, port 27017)
    redis-docker.conf      # Redis config (password, persistence)
```

## Usage (via Make targets)

```bash
# First time — upload playbooks to bastion + install Ansible
make ansible-bootstrap

# Run MongoDB replica set setup
make setup-mongodb

# Run Redis setup
make setup-redis

# Re-sync playbooks after local edits (no reinstall)
make ansible-sync

# Verify health
make check-mongodb
make check-redis
```

## How IPs are resolved

IPs are injected from Pulumi stack outputs at `make` time:

- `MONGO_PRIMARY` / `MONGO_SECONDARY1` / `MONGO_SECONDARY2` → passed as `-e` extra-vars to the playbook
- `REDIS_IP` → used in `hosts.ini` for the `[redis]` group

The `hosts.ini` is **generated on the bastion** by `make create-inventory`.
Never edit it manually — it will be overwritten on the next `make setup-mongodb`.

## Notes

- Replica set name is `rs0` (matches `mongod.conf.j2` `replSetName`)
- Redis password: `VisionSyncRedis2024!` (same in `redis-docker.conf` and `REDIS_URL`)
- The SSH key (`~/.ssh/vision-sync-backend`) is copied to the bastion by `make ansible-bootstrap`
