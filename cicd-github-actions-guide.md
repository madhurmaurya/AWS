# CI/CD Setup with GitHub Actions — My Cloud Calendar

This guide sets up automatic deployment so that every time you push code to GitHub, your app is **automatically built and deployed** to AWS — no manual steps needed.

---

## What is CI/CD and GitHub Actions?

**CI/CD** stands for:
- **CI (Continuous Integration):** Automatically build and test your code every time you push changes.
- **CD (Continuous Deployment):** Automatically deploy your tested code to AWS.

**GitHub Actions** is GitHub's built-in automation tool. You write a YAML file (called a **workflow**) that tells GitHub what to do when something happens (like a code push). GitHub runs it on their servers for free.

### What will happen after this setup?

```
You push code to GitHub (master branch)
        │
        ▼
GitHub Actions automatically runs:
        │
        ├─► Builds the .NET API  →  Deploys to Elastic Beanstalk
        │
        └─► Builds the React app →  Uploads to S3 static bucket
```

You never need to manually run `dotnet publish` or `aws s3 sync` again.

---

## Overview of Steps

1. Create an IAM user in AWS for GitHub to use
2. Add AWS credentials as Secrets in GitHub
3. Create the workflow file in your repository
4. Push and watch it deploy automatically

---

## STEP 1 — Create an IAM User for GitHub Actions

GitHub Actions needs AWS credentials to deploy on your behalf. You'll create a dedicated IAM user with only the permissions it needs.

### Why a separate user?
Never use your personal AWS credentials in CI/CD. A dedicated user limits the blast radius if credentials are ever leaked.

### How to do it:

**1.1** Go to [AWS Console](https://console.aws.amazon.com) → search **IAM** → click **Users** → **Create user**

**1.2** Username: `github-actions-deployer` → click **Next**

**1.3** On the permissions screen, choose **Attach policies directly**, then attach these policies:

| Policy Name | Why it's needed |
|---|---|
| `AdministratorAccess-AWSElasticBeanstalk` | To upload and deploy the API to Elastic Beanstalk |
| `AmazonS3FullAccess` | To upload React build files to S3 static bucket |

> **Note:** For production apps, you'd use a tighter custom policy. For a learning project, these managed policies are fine.

**1.4** Click **Next** → **Create user**

**1.5** Click the new user → go to **Security credentials** tab → scroll to **Access keys** → click **Create access key**

**1.6** Choose **Application running outside AWS** → Next → **Create access key**

**1.7** ⚠️ **IMPORTANT:** Copy both values NOW — you won't see the secret key again:
- **Access key ID** (looks like: `AKIAIOSFODNN7EXAMPLE`)
- **Secret access key** (looks like: `wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY`)

Save them in a temporary notepad — you'll paste them into GitHub in the next step.

---

## STEP 2 — Add Secrets to Your GitHub Repository

GitHub Secrets are encrypted variables that your workflow can access but no one can read (not even you, after saving). This is how you pass AWS credentials safely.

**2.1** Go to your GitHub repo: `https://github.com/madhurmaurya/AWS`

**2.2** Click **Settings** (top tab) → in the left sidebar, click **Secrets and variables** → **Actions**

**2.3** Click **New repository secret** and add each of these one by one:

| Secret Name | Value to paste |
|---|---|
| `AWS_ACCESS_KEY_ID` | The Access key ID from Step 1.7 |
| `AWS_SECRET_ACCESS_KEY` | The Secret access key from Step 1.7 |
| `AWS_REGION` | `us-east-1` (or whatever region you used) |
| `EB_APP_NAME` | `calendar-notes` (your Elastic Beanstalk application name) |
| `EB_ENV_NAME` | Your EB environment name (e.g. `calendar-notes-env`) |
| `S3_STATIC_BUCKET` | Your static bucket name (e.g. `calendar-static-yourname-2026`) |
| `REACT_APP_API_URL` | Your EB URL (e.g. `http://calendar-notes-env.us-east-1.elasticbeanstalk.com/api/notes`) |

> **How to find your EB environment name:** AWS Console → Elastic Beanstalk → your application → the environment name is shown under it (e.g. `Calendar-notes-env`).

After adding all 7 secrets, your Secrets page should show them all (values hidden).

---

## STEP 3 — Create the Workflow File

A GitHub Actions workflow is a YAML file that lives inside your repository at a specific path: `.github/workflows/`. GitHub automatically detects and runs any `.yml` files in that folder.

### 3.1 — Create the folder structure

On your computer, inside your cloned repo, create this folder path:
```
.github/
  workflows/
    deploy.yml        ← this is the file you'll create
```

### 3.2 — Create the workflow file

Create a file at `.github/workflows/deploy.yml` with the following content:

```yaml
# ============================================================
# CI/CD Pipeline — CloudNotes Calendar
# Runs automatically when you push to the master branch
# ============================================================

name: Deploy to AWS

# TRIGGER: This workflow runs whenever you push to 'master'
on:
  push:
    branches:
      - master

jobs:

  # ──────────────────────────────────────────
  # JOB 1: Build and Deploy the .NET API
  #         to Elastic Beanstalk
  # ──────────────────────────────────────────
  deploy-api:
    name: Deploy API to Elastic Beanstalk
    runs-on: ubuntu-latest   # GitHub runs this on a fresh Linux VM

    steps:

      # Step 1: Check out your code onto the GitHub VM
      - name: Checkout code
        uses: actions/checkout@v4

      # Step 2: Install .NET SDK so we can build the C# project
      - name: Setup .NET
        uses: actions/setup-dotnet@v4
        with:
          dotnet-version: '8.0.x'   # Use 8.0 — safest for Elastic Beanstalk
          # If your project targets net10.0, change this to '10.0.x'

      # Step 3: Build and publish the API (same as running dotnet publish locally)
      - name: Publish .NET API
        run: |
          cd CalendarNotesApi
          dotnet publish -c Release -o ./publish

      # Step 4: Zip the published output (same as Compress-Archive on Windows)
      - name: Zip the publish output
        run: |
          cd CalendarNotesApi/publish
          zip -r ../deploy.zip .

      # Step 5: Configure AWS credentials using the secrets you added
      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: ${{ secrets.AWS_REGION }}

      # Step 6: Upload the zip file to S3 (EB needs a zip in S3 to deploy)
      - name: Upload zip to S3 (for Elastic Beanstalk)
        run: |
          # Create a unique version label using the git commit hash
          VERSION_LABEL="api-${{ github.sha }}"
          
          # Upload zip to a deployment bucket
          # Note: EB creates its own S3 bucket automatically — we use it here
          EB_BUCKET="elasticbeanstalk-${{ secrets.AWS_REGION }}-$(aws sts get-caller-identity --query Account --output text)"
          
          aws s3 cp CalendarNotesApi/deploy.zip "s3://${EB_BUCKET}/${VERSION_LABEL}.zip"
          
          # Save for next steps
          echo "VERSION_LABEL=${VERSION_LABEL}" >> $GITHUB_ENV
          echo "EB_BUCKET=${EB_BUCKET}" >> $GITHUB_ENV

      # Step 7: Create a new application version in Elastic Beanstalk
      - name: Create EB application version
        run: |
          aws elasticbeanstalk create-application-version \
            --application-name "${{ secrets.EB_APP_NAME }}" \
            --version-label "${{ env.VERSION_LABEL }}" \
            --source-bundle S3Bucket="${{ env.EB_BUCKET }}",S3Key="${{ env.VERSION_LABEL }}.zip" \
            --region "${{ secrets.AWS_REGION }}"

      # Step 8: Deploy the new version to your EB environment
      - name: Deploy to Elastic Beanstalk
        run: |
          aws elasticbeanstalk update-environment \
            --application-name "${{ secrets.EB_APP_NAME }}" \
            --environment-name "${{ secrets.EB_ENV_NAME }}" \
            --version-label "${{ env.VERSION_LABEL }}" \
            --region "${{ secrets.AWS_REGION }}"

      # Step 9: Wait for the deployment to finish and confirm it's healthy
      - name: Wait for EB deployment to complete
        run: |
          echo "Waiting for Elastic Beanstalk to finish deploying..."
          aws elasticbeanstalk wait environment-updated \
            --application-name "${{ secrets.EB_APP_NAME }}" \
            --environment-names "${{ secrets.EB_ENV_NAME }}" \
            --region "${{ secrets.AWS_REGION }}"
          echo "✅ API deployment complete!"

  # ──────────────────────────────────────────
  # JOB 2: Build and Deploy the React Frontend
  #         to S3 Static Bucket
  # This job runs AFTER the API job succeeds
  # ──────────────────────────────────────────
  deploy-frontend:
    name: Deploy React Frontend to S3
    runs-on: ubuntu-latest
    needs: deploy-api   # Only runs if the API job succeeded

    steps:

      # Step 1: Check out your code
      - name: Checkout code
        uses: actions/checkout@v4

      # Step 2: Install Node.js so we can run npm
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      # Step 3: Install npm packages (same as running npm install locally)
      - name: Install dependencies
        run: |
          cd calendar-frontend
          npm install

      # Step 4: Build the React app with the live EB API URL
      #         REACT_APP_API_URL is baked into the build at this point
      - name: Build React app
        run: |
          cd calendar-frontend
          REACT_APP_API_URL=${{ secrets.REACT_APP_API_URL }} npm run build

      # Step 5: Configure AWS credentials
      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: ${{ secrets.AWS_REGION }}

      # Step 6: Sync the build folder to your S3 static bucket
      #         --delete removes old files that no longer exist
      - name: Deploy to S3
        run: |
          aws s3 sync calendar-frontend/build/ s3://${{ secrets.S3_STATIC_BUCKET }} --delete
          echo "✅ Frontend deployment complete!"
          echo "🌐 Website: http://${{ secrets.S3_STATIC_BUCKET }}.s3-website-${{ secrets.AWS_REGION }}.amazonaws.com"
```

---

## STEP 4 — Commit and Push the Workflow File

Now push this file to GitHub. That's all it takes to activate the pipeline.

```bash
# From your repo root
git add .github/workflows/deploy.yml
git commit -m "Add CI/CD pipeline with GitHub Actions"
git push origin master
```

---

## STEP 5 — Watch It Run

**5.1** Go to your GitHub repo → click the **Actions** tab (top navigation)

**5.2** You'll see a workflow run called **"Deploy to AWS"** has started. Click on it.

**5.3** You'll see two jobs: **Deploy API to Elastic Beanstalk** and **Deploy React Frontend to S3**. Click on either to expand the live log output — every step is visible in real time.

**5.4** Green checkmarks ✅ mean success. A red ✗ means something failed — click the step to read the error message.

The full run typically takes **5–10 minutes** the first time.

---

## How It All Connects — Visual Summary

```
Your Laptop
    │
    │  git push origin master
    ▼
GitHub Repository (madhurmaurya/AWS)
    │
    │  Triggers GitHub Actions
    ▼
GitHub's Linux VM (ubuntu-latest)
    │
    ├─► JOB 1: API
    │       1. Checkout code
    │       2. dotnet publish
    │       3. zip output
    │       4. Upload zip → S3 (EB bucket)
    │       5. Create EB version
    │       6. Deploy to EB environment  ──►  Elastic Beanstalk (ASP.NET API)
    │
    └─► JOB 2: Frontend (runs after JOB 1)
            1. Checkout code
            2. npm install
            3. npm run build (with REACT_APP_API_URL)
            4. aws s3 sync build/  ──►  S3 Static Bucket (React Website)
```

---

## What Each Secret Does (Plain English)

| Secret | Used in | What it does |
|---|---|---|
| `AWS_ACCESS_KEY_ID` | Both jobs | Proves to AWS that GitHub is allowed to deploy |
| `AWS_SECRET_ACCESS_KEY` | Both jobs | The password that goes with the key above |
| `AWS_REGION` | Both jobs | Tells AWS which region (e.g. `us-east-1`) |
| `EB_APP_NAME` | Job 1 | The Elastic Beanstalk application name (`calendar-notes`) |
| `EB_ENV_NAME` | Job 1 | The specific EB environment to deploy to |
| `S3_STATIC_BUCKET` | Job 2 | Which S3 bucket to upload the React build to |
| `REACT_APP_API_URL` | Job 2 | The EB URL baked into the React app at build time |

---

## Common Errors and Fixes

**Error: "No such application version"**
The EB app name or env name doesn't match. Check `EB_APP_NAME` and `EB_ENV_NAME` secrets match exactly what's shown in the AWS Console.

**Error: "An error occurred (InvalidClientTokenId)"**
The `AWS_ACCESS_KEY_ID` or `AWS_SECRET_ACCESS_KEY` secret is wrong. Re-check you copied the full value with no spaces.

**Error: `dotnet` version mismatch**
Your project targets `net10.0` but the workflow installs `8.0.x`. Change the `dotnet-version` line in the workflow to `'10.0.x'`.

**Error: "Access Denied" on S3 sync**
The IAM user (`github-actions-deployer`) is missing `AmazonS3FullAccess`. Go to IAM → Users → the user → Permissions → attach the policy.

**Frontend shows old version after deploy**
Your browser cached the old files. Hard-refresh with `Ctrl+Shift+R` (Windows) or `Cmd+Shift+R` (Mac).

---

## After Every Future Change

Once this is set up, your workflow is:

1. Edit your code locally
2. `git add .` → `git commit -m "..."` → `git push origin master`
3. GitHub Actions automatically deploys both the API and frontend

That's it. No more manual `dotnet publish`, no more manual S3 uploads.

---

## Security Reminder

- Never paste `AWS_ACCESS_KEY_ID` or `AWS_SECRET_ACCESS_KEY` into your code or commit them to Git
- When the project is done, go to IAM → Users → `github-actions-deployer` → delete the access key (or the whole user)
- GitHub Secrets are encrypted and safe — only your workflow can read them
