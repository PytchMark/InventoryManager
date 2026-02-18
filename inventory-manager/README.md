# Inventory Manager (Cloud Run)

This is a standalone Cloud Run app that serves the inventory dashboard and APIs without `google.script.run` or Apps Script runtime.

## What it does

- Serves dashboard UI from `/public/index.html`.
- Reads the `WebsiteItems` Google Sheet through Google Sheets API (Application Default Credentials / Workload Identity).
- Exposes API routes:
  - `GET /api/inventory` → `{ items, summary }` (active items only)
  - `POST /api/items/image` with `{ sku, imageUrl }` → updates column `K (Image URL)` by SKU in column `F`
- Protects dashboard and API with Basic Auth using `ADMIN_USER` + `ADMIN_PASS`.

## Environment variables

| Name | Required | Default | Description |
|---|---|---|---|
| `SPREADSHEET_ID` | Yes | - | Google Sheet ID containing inventory |
| `SHEET_NAME` | No | `WebsiteItems` | Sheet tab name |
| `ADMIN_USER` | Yes | - | Basic Auth username |
| `ADMIN_PASS` | Yes | - | Basic Auth password |
| `PORT` | No | `8080` | HTTP server port |

## Local run

```bash
cd inventory-manager
npm install
export SPREADSHEET_ID="<your-sheet-id>"
export SHEET_NAME="WebsiteItems"
export ADMIN_USER="admin"
export ADMIN_PASS="change-me"
npm start
```

Open: `http://localhost:8080`

> Browser will prompt for Basic Auth credentials.

## Deploy to Cloud Run

```bash
cd inventory-manager
PROJECT_ID="your-gcp-project"
REGION="us-central1"
SERVICE="inventory-manager"

# Build image

gcloud builds submit --tag gcr.io/$PROJECT_ID/$SERVICE

# Deploy (no service account key file; uses attached runtime service account)
gcloud run deploy $SERVICE \
  --image gcr.io/$PROJECT_ID/$SERVICE \
  --region $REGION \
  --platform managed \
  --allow-unauthenticated \
  --set-env-vars SPREADSHEET_ID=<sheet-id>,SHEET_NAME=WebsiteItems,ADMIN_USER=<user>,ADMIN_PASS=<pass>
```

## IAM / Sheets access

The Cloud Run runtime service account must have access to the target spreadsheet:

1. Note the Cloud Run service account email.
2. Share the Google Sheet with that service account email as Editor.
3. Ensure Cloud Run identity has permissions needed for ADC and Sheets API access.

## API examples

```bash
# GET inventory
curl -u "$ADMIN_USER:$ADMIN_PASS" \
  http://localhost:8080/api/inventory

# Update image URL by SKU
curl -u "$ADMIN_USER:$ADMIN_PASS" \
  -H "Content-Type: application/json" \
  -X POST http://localhost:8080/api/items/image \
  -d '{"sku":"ABC123","imageUrl":"https://res.cloudinary.com/..."}'
```
