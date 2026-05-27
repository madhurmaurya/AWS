# CloudNotes Calendar — AWS Deployment Guide

This guide walks through the full AWS assignment for the **Calendar Notes** application: a React calendar frontend, ASP.NET Core API, PostgreSQL database, S3 image storage, and the required AWS infrastructure (VPC, RDS, Elastic Beanstalk, S3 → SQS → Lambda, CloudWatch).

Use **one AWS region** for everything (recommended: **US East (N. Virginia) `us-east-1`**).

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Prerequisites](#prerequisites)
3. [Local Development](#local-development)
4. [Part 1 — VPC (Network)](#part-1--vpc-network)
5. [Part 2 — Security Groups](#part-2--security-groups)
6. [Part 3 — RDS PostgreSQL](#part-3--rds-postgresql)
7. [Part 4 — S3 Buckets](#part-4--s3-buckets)
8. [Part 5 — S3 → SQS → Lambda → CloudWatch](#part-5--s3--sqs--lambda--cloudwatch)
9. [Part 6 — IAM (S3 Access for Elastic Beanstalk)](#part-6--iam-s3-access-for-elastic-beanstalk)
10. [Part 7 — Elastic Beanstalk (Deploy API)](#part-7--elastic-beanstalk-deploy-api)
11. [Part 8 — CORS Configuration](#part-8--cors-configuration)
12. [Part 9 — Deploy React Frontend to S3](#part-9--deploy-react-frontend-to-s3)
13. [Part 10 — CloudWatch Monitoring & Alarms](#part-10--cloudwatch-monitoring--alarms)
14. [Part 11 — Deliverables Checklist](#part-11--deliverables-checklist)
15. [Part 12 — Bonus: CI/CD (GitHub Actions)](#part-12--bonus-cicd-github-actions)
16. [Troubleshooting](#troubleshooting)

---

## Architecture Overview

```
Internet
   │
   ├─► S3 (static React site) ── public read
   │
   └─► Elastic Beanstalk (ASP.NET API in public subnet)
            │
            ├─► RDS PostgreSQL (private subnet, port 5432)
            │
            └─► S3 (note images — API uploads)
                     │
                     └─► S3 Event ──► SQS ──► Lambda ──► CloudWatch Logs

CloudWatch: metrics and CPU alarms on Elastic Beanstalk (EC2) and RDS
```

### Project Structure

| Component | Path | Role |
|-----------|------|------|
| Backend API | `CalendarNotesApi/` | CRUD notes, S3 image upload, PostgreSQL |
| Frontend | `calendar-frontend/` | React calendar UI |
| API endpoint | `/api/notes` | GET, POST, PUT, DELETE |
| Local API port | `5213` | See `Properties/launchSettings.json` |
| Local frontend port | `3000` | Create React App default |

### Two S3 Buckets (Recommended)

| Bucket | Purpose | Who uploads | Who reads |
|--------|---------|-------------|-----------|
| **Static bucket** | React `build/` files | You (after `npm run build`) | Browsers (public) |
| **Images bucket** | Note photos | API on Elastic Beanstalk | Browsers (public URLs) |

---

## Prerequisites

- AWS account (Free Tier eligible)
- AWS CLI (optional, for `aws s3 sync`)
- .NET SDK (project targets `net10.0`; Elastic Beanstalk may require `net8.0` or Docker — check EB platform list)
- Node.js and npm (for React frontend)
- PostgreSQL locally for development (optional)

**Cost control:** Delete NAT Gateway, RDS, and EB environment when the lab is complete. Set a billing alarm in AWS Billing → Budgets.

---

## Local Development

### Run the API

```powershell
cd CalendarNotesApi
dotnet run
```

API runs at `http://localhost:5213`.

### Run the Frontend

```powershell
cd calendar-frontend
npm install
npm start
```

Frontend runs at `http://localhost:3000` and calls `http://localhost:5213/api/notes` by default.

### Local Configuration

Database connection is in `CalendarNotesApi/appsettings.Development.json`:

```json
"ConnectionStrings": {
  "DefaultConnection": "Host=localhost;Database=calendardb;Username=postgres;Password=password"
}
```

**Do not commit production RDS passwords to Git.** Use Elastic Beanstalk environment variables on AWS.

### Environment Variables (AWS)

| Setting | Local | Elastic Beanstalk |
|---------|-------|-------------------|
| Database | `appsettings.Development.json` | `ConnectionStrings__DefaultConnection` |
| S3 bucket | config / env | `AWS__BucketName` |
| AWS region | AWS profile | `AWS__Region` (e.g. `us-east-1`) |
| Frontend API URL | default in `App.js` | `REACT_APP_API_URL` at build time |

.NET maps `AWS__BucketName` → config key `AWS:BucketName` (used in `NotesController.cs`).

---

## Part 1 — VPC (Network)

**Where:** AWS Console → search **VPC** → **Create VPC**

**Assignment requirement:** VPC with at least two subnets (one public, one private).

### Steps

1. Choose **VPC and more** (wizard).
2. Configure:
   - Name: `calendar-vpc`
   - IPv4 CIDR: `10.0.0.0/16`
   - **2 Availability Zones**
   - **2 public subnets** (e.g. `10.0.1.0/24`, `10.0.2.0/24`)
   - **2 private subnets** (e.g. `10.0.11.0/24`, `10.0.12.0/24`)
   - **1 NAT gateway** (not one per AZ — saves cost on Free Tier)
3. Click **Create VPC**.

### Concepts

| Resource | Purpose |
|----------|---------|
| **VPC** | Your private network in AWS |
| **Public subnet** | Route to Internet Gateway; hosts EB instances |
| **Private subnet** | No direct inbound internet; hosts RDS |
| **Internet Gateway** | Public internet access for public subnets |
| **NAT Gateway** | Outbound internet for private subnets (costs money after free tier) |

**Screenshot:** VPC resource map showing public/private subnets and IGW.

---

## Part 2 — Security Groups

**Where:** AWS Console → **VPC** → **Security groups** → **Create security group**

Security groups are firewalls attached to AWS resources.

### Security Group 1: Web App (`sg-web-app`)

| Setting | Value |
|---------|-------|
| VPC | `calendar-vpc` |
| Inbound | HTTP, port **80**, source **0.0.0.0/0** |
| Outbound | Default (all) |

Used by Elastic Beanstalk instances (or reference when EB creates its own SG).

### Security Group 2: Database (`sg-database`)

| Setting | Value |
|---------|-------|
| VPC | `calendar-vpc` |
| Inbound | PostgreSQL, port **5432**, source **sg-web-app** (security group, not IP) |
| Outbound | Default |

**Assignment requirement:** Allow Elastic Beanstalk to access RDS. Only the API server should reach the database on port 5432.

**Note:** After EB is created, you may need to allow the **actual EB instance security group** on RDS (not only `sg-web-app`). See Part 7E.

**Screenshot:** RDS security group inbound rule showing PostgreSQL from EB/web SG.

---

## Part 3 — RDS PostgreSQL

**Where:** AWS Console → **RDS**

**Assignment requirement:** Amazon RDS in a private subnet (`db.t3.micro` or `db.t4g.micro`).

### Step 3.1 — DB Subnet Group

1. RDS → **Subnet groups** → **Create DB subnet group**
2. Name: `calendar-db-subnets`
3. VPC: `calendar-vpc`
4. Add **private subnets only**
5. Create

### Step 3.2 — Create Database

1. RDS → **Databases** → **Create database**
2. Engine: **PostgreSQL**
3. Template: **Free tier**
4. DB instance identifier: `calendar-db`
5. Master username / password: **save securely**
6. Instance: **db.t3.micro** or **db.t4g.micro**
7. Storage: 20 GB (default)
8. **Connectivity:**
   - VPC: `calendar-vpc`
   - Subnet group: `calendar-db-subnets`
   - **Public access: No**
   - VPC security group: **`sg-database`**
9. Initial database name: `calendardb`
10. Create → wait until status **Available**

### Step 3.3 — Connection String

Copy the **Endpoint** from RDS → **Connectivity & security**.

```
Host=<RDS_ENDPOINT>;Port=5432;Database=calendardb;Username=<USER>;Password=<PASSWORD>;SSL Mode=Require;Trust Server Certificate=true
```

Save in a secure note for Elastic Beanstalk (Part 7). You typically cannot connect from your laptop if RDS is private — test through EB after deploy.

**Screenshot:** RDS details, Publicly accessible = No.

---

## Part 4 — S3 Buckets

**Where:** AWS Console → **S3**

**Assignment requirements:** Create S3 bucket; configure public read for static files; later configure S3 → SQS on the images bucket.

### Step 4.1 — Create Two Buckets

Create both in the **same region** as your other resources. Names must be globally unique, e.g.:

- `calendar-static-yourname-2026` — React website
- `calendar-images-yourname-2026` — note images

For each bucket:

1. S3 → **Create bucket**
2. Unique name, same region
3. For public read (assignment): uncheck **Block all public access** and acknowledge the warning (or adjust after creation in Permissions)
4. Create

### Step 4.2 — Public Read Bucket Policy

For **each** bucket: S3 → bucket → **Permissions** → **Bucket policy** → Edit:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "PublicReadGetObject",
      "Effect": "Allow",
      "Principal": "*",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::YOUR-BUCKET-NAME/*"
    }
  ]
}
```

Replace `YOUR-BUCKET-NAME` with the exact bucket name.

| JSON field | Meaning |
|------------|---------|
| `"Principal": "*"` | Any internet user |
| `"Action": "s3:GetObject"` | Read only (not upload/delete) |
| `"Resource": ".../*"` | All objects in the bucket |

If the policy fails to save, edit **Block public access** on the bucket and allow public policies.

### Step 4.3 — Test Public Read

1. Upload a small test file to either bucket
2. Open the **Object URL** in a browser
3. Success: file displays or downloads. Failure: `Access Denied` — fix policy or block public access settings.

### Step 4.4 — Static Website Hosting (Static Bucket Only)

1. S3 → **static** bucket → **Properties** → **Static website hosting** → **Edit**
2. Enable **Host a static website**
3. Index document: `index.html`
4. Error document: `index.html` (helps React SPA routing)
5. Save and copy the **Bucket website endpoint** (e.g. `http://calendar-static-....s3-website-us-east-1.amazonaws.com`)

Save this URL for CORS (Part 8) and frontend access (Part 9).

**Do not upload React files yet** — that is Part 9.

### How the API Uses the Images Bucket

`NotesController.cs` reads `AWS:BucketName`, uploads via S3 SDK, and stores URLs like:

```
https://<bucket>.s3.amazonaws.com/<guid>_<filename>
```

On Elastic Beanstalk, set `AWS__BucketName` and ensure the EC2 instance role can `s3:PutObject` (Part 6).

**Screenshots:** Bucket list, bucket policy, test file in browser, static website endpoint.

---

## Part 5 — S3 → SQS → Lambda → CloudWatch

**Where:** AWS Console (SQS, S3, Lambda, CloudWatch)

**Assignment requirement:** S3 triggers SQS on upload; Lambda triggered by SQS writes logs to CloudWatch.

This pipeline is **automatic** — your C# API does not need to call SQS. Any upload to the **images** bucket (manual or via API) can trigger it.

```
File uploaded to images bucket
    → S3 sends message to SQS
        → Lambda reads message
            → Lambda writes to CloudWatch Logs
```

### Step 5.1 — Create SQS Queue

1. Search **SQS** → **Queues** → **Create queue**
2. Type: **Standard**
3. Name: `calendar-s3-events`
4. Create → copy **Queue ARN** to Notepad

### Step 5.2 — SQS Access Policy (Allow S3 to Send)

SQS → queue → **Access policy** → Edit. Replace `REGION`, `ACCOUNT_ID`, and bucket name:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowS3ToSendMessage",
      "Effect": "Allow",
      "Principal": {
        "Service": "s3.amazonaws.com"
      },
      "Action": "sqs:SendMessage",
      "Resource": "arn:aws:sqs:REGION:ACCOUNT_ID:calendar-s3-events",
      "Condition": {
        "ArnLike": {
          "aws:SourceArn": "arn:aws:s3:::calendar-images-yourname-2026"
        }
      }
    }
  ]
}
```

Find **Account ID:** top-right account menu → Account ID.

### Step 5.3 — S3 Event Notification

1. S3 → **images** bucket (not static) → **Properties** → **Event notifications** → **Create**
2. Name: `on-image-upload`
3. Event types: **All object create events**
4. Destination: **SQS queue** → `calendar-s3-events`
5. Save

### Step 5.4 — Create Lambda Function

1. Search **Lambda** → **Functions** → **Create function**
2. **Author from scratch**
3. Name: `calendar-s3-logger`
4. Runtime: **Python 3.12** (or Node.js 20)
5. **Execution role:** **Create a new role with basic Lambda permissions**
   - This creates `AWSLambdaBasicExecutionRole` for CloudWatch Logs
6. Create function

**Example Python code:**

```python
import json
import logging

logger = logging.getLogger()
logger.setLevel(logging.INFO)

def lambda_handler(event, context):
    logger.info("Lambda started, record count: %s", len(event.get("Records", [])))
    for record in event.get("Records", []):
        logger.info("SQS body: %s", record.get("body"))
    return {"statusCode": 200}
```

Click **Deploy**.

### Step 5.5 — Add SQS Permissions to Lambda Role

If adding the SQS trigger fails with *"execution role does not have permissions to call ReceiveMessage"*:

1. Lambda → **Configuration** → **Permissions** → click **Role name**
2. IAM → **Add permissions** → **Attach policies**
3. Attach **`AWSLambdaSQSQueueExecutionRole`**

### Step 5.6 — Add SQS Trigger

1. Lambda → **Configuration** → **Triggers** → **Add trigger**
2. Source: **SQS**
3. Queue: `calendar-s3-events`
4. Batch size: 10
5. Save

### Step 5.7 — Test Pipeline

1. S3 → **images** bucket → **Upload** a test file
2. Wait 1–2 minutes
3. Lambda → **Monitor** → **Invocations** should increase
4. CloudWatch → **Log groups** → `/aws/lambda/calendar-s3-logger` → latest **Log stream**

**Manual test (isolates logging):** Lambda → **Test** tab → use SQS test event:

```json
{
  "Records": [
    {
      "body": "{\"test\": true}"
    }
  ]
}
```

If manual test logs appear but S3 upload does not trigger Lambda, check S3 event notification and SQS access policy.

**Screenshots:** SQS queue, S3 event, Lambda trigger, CloudWatch log lines.

---

## Part 6 — IAM (S3 Access for Elastic Beanstalk)

**Where:** AWS Console → **IAM** → **Roles**

The API uploads images using the **EC2 instance profile** on Elastic Beanstalk — not your laptop AWS credentials.

### Find the EB Instance Role

Elastic Beanstalk → environment → **Configuration** → **Security** (or **Instances**) → note **EC2 instance profile** / role name (often `aws-elasticbeanstalk-ec2-role` or similar).

### Attach S3 Policy

IAM → role → **Add permissions** → **Create inline policy** → JSON:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"],
      "Resource": "arn:aws:s3:::calendar-images-yourname-2026/*"
    },
    {
      "Effect": "Allow",
      "Action": "s3:ListBucket",
      "Resource": "arn:aws:s3:::calendar-images-yourname-2026"
    }
  ]
}
```

Replace bucket name. Name the policy e.g. `CalendarNotesS3Access`.

Without this, notes may save but **image upload fails** with AccessDenied in EB logs.

---

## Part 7 — Elastic Beanstalk (Deploy API)

**Where:** PowerShell (build) + AWS Console (EB) + Browser (test)

**Assignment requirement:** Create Elastic Beanstalk and deploy a web application.

### Step 7A — Build Deploy Package

```powershell
cd CalendarNotesApi
dotnet publish -c Release -o .\publish
cd .\publish
Compress-Archive -Path * -DestinationPath ..\deploy.zip -Force
```

Output: `CalendarNotesApi\deploy.zip`

**Note:** If .NET 10 is not supported on EB, retarget to `net8.0` or use a **Dockerfile** on the EB Docker platform.

### Step 7B — Create Application & Configure Service Access

1. AWS Console → **Elastic Beanstalk** → **Create application**
2. Application name: `calendar-notes`
3. Platform: **.NET on Linux** (or **Docker**)
4. Application code: **Upload** `deploy.zip`
5. Preset: **Single instance** (cheaper for learning)

#### Configure Service Access (Important)

Elastic Beanstalk needs IAM roles to manage infrastructure and run your app:

| Role | Who uses it | Purpose |
|------|-------------|---------|
| **Service role** | Elastic Beanstalk service | Create/update EC2, Auto Scaling, load balancer, CloudWatch log streaming |
| **EC2 instance profile** | EC2 instances running your app | Runtime AWS access (S3 uploads, logs) |

**Recommended selections:**

- **Service role:** **Create and use new service role** (or select `aws-elasticbeanstalk-service-role` if it exists)
- **EC2 instance profile:** `aws-elasticbeanstalk-ec2-role` (or EB recommended default)

6. Submit → wait until health is **Green** (10–20+ minutes first time)

If creation fails with Auto Scaling / EC2 access errors, see [Troubleshooting — Elastic Beanstalk Auto Scaling Failed](#elastic-beanstalk-auto-scaling--ec2-access-failed).

### Step 7C — VPC Configuration (If Using Custom VPC)

EB → environment → **Configuration** → **Network** → **Edit**:

- VPC: `calendar-vpc`
- Instance subnets: **public** subnets
- Database: leave empty (RDS is separate)

Apply and wait for update.

### Step 7D — Environment Variables

EB → **Configuration** → **Software** → **Edit** → **Environment properties**:

| Key | Value |
|-----|-------|
| `ConnectionStrings__DefaultConnection` | Full RDS connection string (Part 3) |
| `AWS__BucketName` | Images bucket name |
| `AWS__Region` | e.g. `us-east-1` |
| `ASPNETCORE_ENVIRONMENT` | `Production` |

Apply → environment restarts.

### Step 7E — Security Group: EB → RDS

1. EB → environment → find **EC2 instance** → note its **security group**
2. VPC → **Security groups** → **`sg-database`** → **Edit inbound rules**
3. PostgreSQL **5432** from **EB instance security group**
4. Save

### Step 7F — Test API

Open in browser:

```
http://YOUR-EB-DOMAIN/api/notes
```

**Success:** `[]` or JSON array. **Failure (502):** EB → **Logs** → **Last 100 lines** — often wrong DB connection or security group.

**Screenshot:** Green health, `/api/notes` response in browser.

---

## Part 8 — CORS Configuration

**Where:** Code editor (`Program.cs`) + redeploy to EB

When the React app runs on **S3**, the browser blocks API calls unless the API explicitly allows the S3 website origin.

### The Problem

| Environment | Frontend | API | Works today? |
|-------------|----------|-----|--------------|
| Local | `http://localhost:3000` | `http://localhost:5213` | Yes (CORS allows localhost) |
| AWS | S3 website URL | EB URL | **No** until CORS updated |

### The Fix

In `CalendarNotesApi/Program.cs`, add your S3 website endpoint to `WithOrigins`:

```csharp
policy.WithOrigins(
    "http://localhost:3000",
    "http://calendar-static-yourname-2026.s3-website-us-east-1.amazonaws.com"
)
```

Rules:
- Match **http** vs **https** exactly as the browser uses
- No trailing slash
- Use **website endpoint**, not the S3 object URL format

### Redeploy

```powershell
cd CalendarNotesApi
dotnet publish -c Release -o .\publish
cd .\publish
Compress-Archive -Path * -DestinationPath ..\deploy.zip -Force
```

EB → **Upload and deploy** → new `deploy.zip`.

### Verify

Browser F12 → Console: no CORS errors. Network tab shows `/api/notes` with status 200.

---

## Part 9 — Deploy React Frontend to S3

**Where:** PowerShell + AWS Console (S3)

### Step 9.1 — Build with EB API URL

```powershell
cd calendar-frontend
$env:REACT_APP_API_URL="http://YOUR-EB-DOMAIN/api/notes"
npm run build
```

`App.js` uses `process.env.REACT_APP_API_URL || 'http://localhost:5213/api/notes'`.

### Step 9.2 — Upload to Static Bucket

**Console:** S3 → **static** bucket → **Upload** → select **all files inside** `calendar-frontend/build` (including `index.html` at the root level, not nested under a `build/` folder).

**CLI (optional):**

```powershell
aws s3 sync .\build\ s3://calendar-static-yourname-2026 --delete
```

### Step 9.3 — Open Website

S3 → static bucket → **Properties** → **Static website hosting** → open **Bucket website endpoint**.

### End-to-End Test

1. Create a note with text and image
2. Refresh — note and image persist (RDS + S3)
3. Upload triggers Lambda logs (Part 5)

| Failure | Check |
|---------|-------|
| CORS error | Part 8 — exact S3 website URL in CORS |
| Note saves, no image | Part 6 — IAM S3 on EB role |
| Image 403 | Part 4 — bucket policy on images bucket |
| Blank calendar | Wrong `REACT_APP_API_URL` — rebuild and re-upload |

**Screenshot:** Browser showing calendar with note and image.

---

## Part 10 — CloudWatch Monitoring & Alarms

**Where:** AWS Console

**Assignment requirements:** CloudWatch monitoring on EB and RDS; review EB logs; CPU alarms on both.

### RDS Monitoring

RDS → **Databases** → `calendar-db` → **Monitoring** tab → view CPUUtilization graph.

### EB Monitoring

Elastic Beanstalk → environment → **Monitoring** tab.

### EB Logs in CloudWatch

- EB → **Logs** → request/full logs, or
- CloudWatch → **Log groups** → search `elasticbeanstalk` → open latest log stream

**Screenshot:** Log lines from EB environment.

### RDS CPU Alarm

1. CloudWatch → **Alarms** → **Create alarm**
2. Metric → **RDS** → **CPUUtilization** → your database
3. Threshold: Greater than **80**% for 5 minutes (example)
4. Name: `rds-calendar-high-cpu`
5. Create

### EB CPU Alarm

1. EC2 → **Instances** → find EB instance → note instance ID
2. CloudWatch → **Create alarm**
3. Metric → **EC2** → **CPUUtilization** → that instance
4. Same threshold
5. Name: `eb-calendar-high-cpu`

**Screenshot:** Both alarms in CloudWatch Alarms list (OK state is fine).

---

## Part 11 — Deliverables Checklist

### Screenshots (Suggested Order)

1. VPC with public + private subnets
2. RDS (private, Available)
3. Security group: RDS allows EB on 5432
4. S3 buckets + public read policy
5. S3 event notification → SQS
6. SQS queue
7. Lambda function + SQS trigger
8. CloudWatch Lambda logs
9. Elastic Beanstalk green health
10. Browser: `/api/notes` JSON
11. CloudWatch EB logs
12. RDS CPU alarm
13. EB CPU alarm
14. Full calendar app with note + image
15. (Bonus) CI/CD pipeline success

### Code Repository Should Include

- `CalendarNotesApi/` — full API
- `calendar-frontend/` — React app
- Optional: `Dockerfile`, `.github/workflows/deploy.yml`
- This `README.md`

**Do not commit:** RDS passwords, AWS access keys, `.env` with secrets.

---

## Part 12 — Bonus: CI/CD (GitHub Actions)

**Where:** GitHub + IAM + Code editor

### Outline

1. Push repository to GitHub
2. IAM → create user for CI → access keys
3. GitHub → repo → **Settings** → **Secrets**:
   - `AWS_ACCESS_KEY_ID`
   - `AWS_SECRET_ACCESS_KEY`
   - `AWS_REGION`
4. Add `.github/workflows/deploy.yml`:
   - On push to `main`: `dotnet publish` → deploy to EB
   - `npm run build` with `REACT_APP_API_URL` → `aws s3 sync` to static bucket

Do this **after** manual deployment works.

---

## Troubleshooting

### Lambda: "execution role does not have permissions to call ReceiveMessage on SQS"

**Fix:** IAM → Lambda execution role → attach **`AWSLambdaSQSQueueExecutionRole`** → add SQS trigger again.

### Lambda: No logs in CloudWatch

1. Confirm **same region** for Lambda and CloudWatch
2. Log group: `/aws/lambda/<function-name>`
3. Lambda → **Monitor** → **Invocations** — if 0, pipeline not triggered
4. **Manual test** in Lambda with SQS test event — if logs appear, fix S3 → SQS (event on **images** bucket, queue access policy)
5. Click **Deploy** after editing Lambda code

### Elastic Beanstalk: 502 Bad Gateway

- EB → **Logs** → **Last 100 lines**
- Check RDS connection string env var
- Check RDS security group allows EB instance SG on port 5432
- Verify app listens on correct port (Docker: `8080` / `ASPNETCORE_URLS`)

### CORS Blocked in Browser

- Add exact S3 **website endpoint** to `WithOrigins` in `Program.cs`
- Redeploy API to EB
- Ensure `REACT_APP_API_URL` points to EB domain when building frontend

### S3 Image Upload AccessDenied

- IAM → EB EC2 instance role → S3 PutObject policy on images bucket (Part 6)
- Verify `AWS__BucketName` env var on EB

### S3 Object URL Access Denied (403)

- Bucket policy with `s3:GetObject` for `Principal: *`
- Block public access settings allow the policy

### Elastic Beanstalk Auto Scaling / EC2 Access Failed

Error example:

```
Unable to access EC2 - account may be suspended or terminated
(Service: AutoScaling, Status Code: 400)
```

**Fixes (in order):**

1. **Service access:** Use **Create and use new service role** + default **`aws-elasticbeanstalk-ec2-role`**
2. **IAM → Roles:** Confirm **`AWSServiceRoleForAutoScaling`** exists (Auto Scaling service-linked role)
3. **Same region** for VPC, EB, RDS, S3
4. **CloudFormation** → failed EB stack → **Events** tab for detailed reason
5. Delete failed environment and recreate after fixing roles

### Cannot Connect to RDS from Laptop

**Expected** if RDS is private (assignment requirement). Test database through the API on Elastic Beanstalk only.

---

## Recommended Work Order

```
Part 1  → VPC
Part 2  → Security groups
Part 3  → RDS
Part 4  → S3 buckets + policies + static website
Part 5  → SQS + S3 event + Lambda + test logs
Part 7  → Elastic Beanstalk + env vars + test /api/notes
Part 6  → IAM S3 on EB role (if image upload needed)
Part 8  → CORS + redeploy API
Part 9  → React build + S3 upload + full test
Part 10 → CloudWatch metrics + CPU alarms + screenshots
Part 12 → CI/CD (optional bonus)
```

---

## Assignment Requirements Mapping

| Requirement | Part |
|-------------|------|
| VPC with public + private subnets | Part 1 |
| Elastic Beanstalk + web app | Part 7 |
| RDS in private subnet | Part 3 |
| Security groups: EB → RDS | Part 2, 7E |
| S3 bucket + S3 → SQS on upload | Part 4, 5 |
| Lambda on SQS → CloudWatch logs | Part 5 |
| S3 public read for static files | Part 4 |
| CloudWatch monitoring EB + RDS | Part 10 |
| CPU alarms EB + RDS | Part 10 |
| Review EB logs in CloudWatch | Part 10 |
| CI/CD bonus | Part 12 |

---

## License & Notes

This project is for educational AWS assignment purposes. Rotate and remove credentials after submission. Tear down billable resources (NAT Gateway, RDS, EB) when finished.
