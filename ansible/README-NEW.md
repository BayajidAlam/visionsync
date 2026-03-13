# VisionSync Ansible Quickstart

This guide is a lightweight operational reference for the current bastion-first Ansible flow.

## Execution model

- Run Ansible from the bastion host for private subnet targets.
- Keep local machine focused on build/push and orchestration.
- Generate inventory from Pulumi outputs before running playbooks.

## Recommended sequence

1. Generate live inventory (`ansible/live-inventory.ini`) from Pulumi outputs.
2. Sync `ansible/` to bastion.
3. Ensure bastion has:
   - `~/.ssh/vision-sync-backend`
   - `ansible-playbook`
4. Run playbooks from bastion:
   - `mongodb-replica-setup.yml`
   - `redis-setup.yml`
   - `deploy-backend.yml`
   - `deploy-client.yml`

## Notes

- Inventory files in this repo are templates or generated artifacts.
- Avoid hardcoded environment-specific IPs in committed automation.
- Use `pulumi stack output` as source of truth for runtime endpoints.
