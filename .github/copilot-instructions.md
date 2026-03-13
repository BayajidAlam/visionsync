# Project Guidelines

## Code Style
- Use TypeScript-first patterns across `server/`, `client/`, `lambda/`, `container/`, and `IaC/`.
- Keep changes scoped to the requested task; avoid unrelated refactors.
- Follow existing lint and TypeScript settings in each package.
- Do not commit secrets, credentials, generated artifacts, or environment-specific IP updates unless explicitly requested.

## Architecture
- Read `.agents/CONTEXT.md` before making architecture-impacting changes.
- Component boundaries:
  - `client/`: React + Vite UI, DASH playback, Socket.IO client.
  - `server/`: Express + Socket.IO API, presigned upload flow, webhook receiver, video status state.
  - `lambda/`: SQS-triggered ECS task launcher.
  - `container/`: FFmpeg transcoding worker that uploads outputs and calls webhook.
  - `IaC/`: Pulumi infrastructure and stack outputs.
  - `ansible/`: SSH-based host setup and deployment automation.
- Processing lifecycle is: `UPLOADING -> UPLOADED -> PROCESSING -> READY|ERROR`.
- Private resources are accessed through bastion/jump-host flows; treat direct private host access as non-default.

## Build And Test
- Preferred root commands:
  - `make install` to install dependencies across packages.
  - `make build` to build all packages.
  - `make dev` to run local backend and frontend.
  - `make status` and `make outputs` for deployment verification.
- Package commands:
  - `server/`: `npm run dev`, `npm run build`, `npm run lint`
  - `client/`: `npm run dev`, `npm run build`, `npm run lint`
  - `lambda/`: `npm run build`, `npm run package`
  - `container/`: `npm run build`, `npm run dev`
  - `IaC/`: `npm run build`, `npm run preview`, `npm run deploy`
- Deploy workflows are production-impacting (`make deploy`, `make deploy-prod`, `make deploy-server`, `make deploy-client`); run only when explicitly requested.
- Treat destructive targets like `make destroy` and `make reset` as confirmation-required.

## Conventions
- For architecture or data-flow documentation, generate raw `.excalidraw` JSON; do not generate Mermaid diagrams.
- Keep backend proxy behavior intact when editing server bootstrap (`trust proxy` matters behind ALB).
- Frontend production builds depend on build-time `VITE_API_URL`; ensure ALB/API URL correctness before shipping.
- Prefer Pulumi outputs over hardcoded infrastructure values when updating deployment scripts.
- ECR login tokens expire; re-authenticate before push/pull during deployment troubleshooting.
- When architecture or data flow changes, update related docs together (`Readme.md`, `doc/`, `.agents/CONTEXT.md`).

## Key References
- `.agents/CONTEXT.md`
- `Readme.md`
- `Makefile`
- `DEPLOYMENT.md`