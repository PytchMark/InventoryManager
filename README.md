# InventoryManager

This repository contains:

- Legacy Apps Script sources (`code.gs`, `dashboard.html`) kept unchanged.
- A new standalone Cloud Run app in `inventory-manager/`.

## Cloud Build / Cloud Run note

A root-level `Dockerfile` is included so CI/CD triggers that run `docker build .` from the repository root work out-of-the-box.

- Root `Dockerfile` builds and runs the app from `inventory-manager/`.
- If you are deploying manually from inside `inventory-manager/`, you can still use `inventory-manager/Dockerfile` directly.

See `inventory-manager/README.md` for full setup and deployment steps.
