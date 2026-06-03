# Advanced AWS Assignment — Step-by-Step Guide
## Building on top of the existing CloudNotes Calendar deployment

This guide covers **only the new requirements** not in the basic assignment.
Each section tells you exactly where to go, what to click, and why.

---

## What's new vs basic assignment (quick diff)

| # | New Requirement | Builds on |
|---|---|---|
| 1 | VPC subnets across **two AZs** | Already done — verify AZs |
| 2 | EBS **autoscaling** on CPU | New — configure in EB |
| 3 | RDS **automated backups** | New — enable in RDS settings |
| 4 | S3 **versioning** | New — enable on images bucket |
| 5 | S3 **lifecycle policies** | New — transition to cheaper storage |
| 6 | S3 triggers **both SQS and SNS** | Basic had SQS only — add SNS |
| 7 | Lambda subscribes to **SNS** | Basic had Lambda on SQS — add SNS path |
| 8 | **Secrets Manager** for RDS connection string | New — replace EB env var |
| 9 | **DynamoDB** table for logs/metadata | New service |
| 10 | **EventBridge** scheduled Lambda | New — runs Lambda on a timer |
| 11 | **IAM least privilege** for Lambda | Tighten existing Lambda role |
| 12 | **CloudWatch dashboard** | New — visualize all services |
| 13 | S3 **bucket access logging** | New — enable on buckets |

---

## PART 1 — Verify VPC subnets are across two AZs

### What the requirement means
Your basic VPC already has 2 public + 2 private subnets. The advanced requirement
just explicitly says they must be in **different availability zones** (e.g. ap-south-1a
and ap-south-1b). Since you used the VPC wizard with 2 AZs, this is likely already done.

### How to verify
1. AWS Console → **VPC** → **Subnets**
2. Filter by your VPC (`calendar-vpc`)
3. Look at the **Availability Zone** column for each subnet

You should see something like:

| Subnet | Type | AZ |
|---|---|---|
| calendar-subnet-public1 | public | ap-south-1a |
| calendar-subnet-public2 | public | ap-south-1b |
| calendar-subnet-private1 | private | ap-south-1a |
| calendar-subnet-private2 | private | ap-south-1b |

If all subnets show the same AZ, you need to edit one subnet per type:
- Subnets → select subnet → **Actions → Edit subnet settings** — you cannot
  change the AZ of an existing subnet. You would need to create new subnets
  in the second AZ and add them to the RDS subnet group.

> Most likely you're already fine since the basic setup used the wizard with 2 AZs.

**Screenshot to take:** Subnets list showing two different AZs.

---

## PART 2 — EBS Autoscaling based on CPU utilization

### What this means
Right now your EB runs on a single EC2 instance. Autoscaling means AWS automatically
adds more instances when CPU is high and removes them when load drops.

### Important: Single Instance → Load Balanced

Your basic setup uses **Single instance** (cheaper). Autoscaling requires
**Load balanced** tier. This change will briefly restart your environment
and slightly increases cost (an ALB costs ~$16/month — delete when done).

### Steps

**2.1** EB → your environment → **Configuration** → **Capacity** → **Edit**

**2.2** Change **Environment type** from `Single instance` to `Load balanced`

**2.3** Under **Auto Scaling group**, set:

| Setting | Value |
|---|---|
| Min instances | 1 |
| Max instances | 2 |
| Fleet composition | On-Demand |

**2.4** Scroll down to **Scaling triggers** → **Add trigger**:

| Field | Value |
|---|---|
| Metric | CPUUtilization |
| Statistic | Average |
| Unit | Percent |
| Period | 5 minutes |
| Breach duration | 1 period |
| Upper threshold | 70 (scale out when CPU > 70%) |
| Scale out increment | 1 |
| Lower threshold | 20 (scale in when CPU < 20%) |
| Scale in increment | -1 |

**2.5** Click **Apply** → wait for environment to update (5–10 min)

### What just happened
AWS created an **Auto Scaling Group** and an **Application Load Balancer**.
Your EB URL now points to the ALB, which routes traffic to 1–2 EC2 instances.
If CPU > 70% for 5 minutes, a second instance launches automatically.

### Verify
EB → **Configuration** → **Capacity** — you should see the ASG min/max.
EB → environment overview — health shows your instances count.

**Screenshot:** EB configuration showing Load balanced, min 1 max 2, CPU trigger.

---

## PART 3 — RDS automated backups with retention period

### What this means
AWS automatically takes a daily snapshot of your database and keeps it for N days.
If your database gets corrupted, you can restore it to any point in time within
that window.

### Steps

**3.1** RDS → **Databases** → click `calendar-db`

**3.2** Click **Modify** (top right button)

**3.3** Scroll to **Backup** section:

| Setting | Value |
|---|---|
| Automated backups | Enable |
| Backup retention period | **7 days** (free tier allows up to 7, beyond that may cost) |
| Backup window | No preference (or set a specific off-peak time like 03:00–04:00 UTC) |

**3.4** Scroll to bottom → click **Continue**

**3.5** Under **Scheduling of modifications**, choose **Apply immediately**

**3.6** Click **Modify DB instance**

### Verify
RDS → `calendar-db` → **Maintenance & backups** tab → you should see
**Automated backups: Enabled** and retention period.

After the first backup window passes (usually within 24 hours), you'll see
a backup listed under RDS → **Automated backups**.

**Screenshot:** RDS Maintenance & backups tab showing backups enabled, 7-day retention.

---

## PART 4 — S3 versioning on the images bucket

### What this means
Every time a file is uploaded with the same key (filename), S3 keeps all previous
versions instead of overwriting. You can restore an older version if needed.

### Steps

**4.1** S3 → your **images** bucket (`calendar-images-yourname-2026`)

**4.2** **Properties** tab → scroll to **Bucket Versioning** → **Edit**

**4.3** Select **Enable** → **Save changes**

### What you'll notice
After enabling versioning, when you upload the same filename twice, S3 stores
both versions. In the Objects tab, click **Show versions** toggle to see them.

> **Cost note:** Versioned objects all count toward storage costs.
> The lifecycle policy in Part 5 will manage this.

**Screenshot:** Bucket Properties showing Bucket Versioning: Enabled.

---

## PART 5 — S3 lifecycle policies

### What this means
Automatically move older objects to cheaper storage classes after a set number of days.
AWS S3 storage classes from most to least expensive (roughly):

```
Standard → Standard-IA → Glacier Instant Retrieval → Glacier Deep Archive
(instant)    (retrieval fee)     (ms retrieval)           (hours retrieval)
```

You pay less per GB but pay a retrieval fee. Good for old images that are rarely accessed.

### Steps

**5.1** S3 → **images** bucket → **Management** tab → **Lifecycle rules** → **Create lifecycle rule**

**5.2** Fill in the rule:

| Setting | Value |
|---|---|
| Rule name | `transition-old-images` |
| Rule scope | Apply to all objects in the bucket |

**5.3** Under **Lifecycle rule actions**, check:
- ✅ Transition current versions of objects between storage classes
- ✅ Transition previous versions of objects between storage classes (since you enabled versioning)
- ✅ Expire previous versions of objects (to avoid infinite version accumulation)

**5.4** Add transitions for **current versions**:

| Days after creation | Transition to |
|---|---|
| 30 days | Standard-IA |
| 90 days | Glacier Instant Retrieval |

**5.5** Add transition for **previous versions**:

| Days after becoming non-current | Transition to |
|---|---|
| 30 days | Standard-IA |

**5.6** Add expiration for **previous versions**:
- Permanently delete previous versions after **90 days**

**5.7** Click **Create rule**

### What this means in plain English
- A newly uploaded image stays in Standard (fast, full cost) for 30 days
- After 30 days it moves to Standard-IA (cheaper, small retrieval fee)
- After 90 days it moves to Glacier (very cheap, takes milliseconds to retrieve)
- Old versions of overwritten files are deleted after 90 days

**Screenshot:** Lifecycle rule shown in the Management tab.

---

## PART 6 — S3 triggers both SQS and SNS

### What's changing
Your basic setup: S3 → SQS → Lambda
New advanced setup: S3 → SQS (existing) + S3 → SNS (new) → Lambda

SNS (Simple Notification Service) is a pub/sub system. Multiple subscribers
(Lambda, email, SQS, HTTP endpoints) can all receive the same notification.

### Step 6.1 — Create SNS Topic

1. AWS Console → search **SNS** → **Topics** → **Create topic**
2. Type: **Standard**
3. Name: `calendar-image-uploads`
4. Click **Create topic**
5. Copy the **Topic ARN** — looks like `arn:aws:sns:ap-south-1:123456789:calendar-image-uploads`

### Step 6.2 — Allow S3 to publish to SNS

SNS → your topic → **Access policy** → **Edit**

Replace the existing policy with this (fill in your values):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowS3Publish",
      "Effect": "Allow",
      "Principal": {
        "Service": "s3.amazonaws.com"
      },
      "Action": "SNS:Publish",
      "Resource": "arn:aws:sns:YOUR_REGION:YOUR_ACCOUNT_ID:calendar-image-uploads",
      "Condition": {
        "ArnLike": {
          "aws:SourceArn": "arn:aws:s3:::calendar-images-yourname-2026"
        }
      }
    }
  ]
}
```

Click **Save changes**.

### Step 6.3 — Add SNS event notification on S3 bucket

S3 → **images** bucket → **Properties** → **Event notifications** → **Create event notification**

| Setting | Value |
|---|---|
| Name | `on-image-upload-sns` |
| Event types | All object create events |
| Destination | **SNS topic** |
| SNS topic | `calendar-image-uploads` |

Save. Now every upload fires **two** notifications: one to SQS (existing), one to SNS (new).

**Screenshot:** S3 Event notifications list showing both SQS and SNS destinations.

---

## PART 7 — Lambda subscribes to SNS

### What's changing
Your basic Lambda was triggered by SQS. Now create a **second Lambda** (or add
an SNS subscription to the existing one) that gets invoked directly by SNS.

We'll create a second Lambda to keep concerns separate and demonstrate both patterns.

### Step 7.1 — Create the SNS Lambda function

1. Lambda → **Create function** → **Author from scratch**
2. Name: `calendar-sns-processor`
3. Runtime: **Python 3.12**
4. Execution role: **Create a new role with basic Lambda permissions**
5. Create function

**Paste this code:**

```python
import json
import logging

logger = logging.getLogger()
logger.setLevel(logging.INFO)

def lambda_handler(event, context):
    logger.info("SNS Lambda triggered. Records: %d", len(event.get("Records", [])))

    for record in event.get("Records", []):
        # SNS wraps the S3 notification as a string in record["Sns"]["Message"]
        sns_message = record.get("Sns", {})
        subject = sns_message.get("Subject", "No subject")
        message_str = sns_message.get("Message", "{}")

        logger.info("SNS Subject: %s", subject)

        try:
            message = json.loads(message_str)
            # The S3 notification is nested inside the SNS message
            s3_records = message.get("Records", [])
            for s3_record in s3_records:
                bucket = s3_record.get("s3", {}).get("bucket", {}).get("name", "unknown")
                key = s3_record.get("s3", {}).get("object", {}).get("key", "unknown")
                size = s3_record.get("s3", {}).get("object", {}).get("size", 0)
                logger.info("File uploaded — Bucket: %s | Key: %s | Size: %d bytes", bucket, key, size)
        except json.JSONDecodeError:
            logger.warning("Could not parse SNS message body as JSON: %s", message_str)

    return {"statusCode": 200}
```

Click **Deploy**.

### Step 7.2 — Subscribe Lambda to SNS topic

1. SNS → **Topics** → `calendar-image-uploads` → **Create subscription**
2. Protocol: **Lambda**
3. Endpoint: ARN of `calendar-sns-processor` (copy from Lambda → Function overview)
4. Create subscription

SNS will automatically confirm the subscription.

### Step 7.3 — Verify

1. S3 → images bucket → upload a test file
2. Wait 30 seconds
3. Lambda → `calendar-sns-processor` → **Monitor** → **View CloudWatch logs**
4. You should see log lines showing the bucket name, key, and file size

**Screenshot:** CloudWatch logs from `calendar-sns-processor` showing file details.

---

## PART 8 — AWS Secrets Manager for RDS connection string

### What this means
Right now your RDS password is stored as a plain text environment variable in
Elastic Beanstalk. Secrets Manager stores it encrypted and rotates it automatically.
Your Lambda (or API) fetches the secret at runtime — the password never appears in
config files or environment variables in plain text.

> **Cost note:** Secrets Manager is free for 30 days, then ~$0.40/secret/month.
> For a learning project, this is minimal cost.

### Step 8.1 — Store the secret

1. AWS Console → search **Secrets Manager** → **Store a new secret**

2. Secret type: **Credentials for Amazon RDS database**

3. Fill in:
   - Username: your RDS master username (e.g. `postgres`)
   - Password: your RDS master password
   - Database: select `calendar-db` from the dropdown

4. Click **Next**

5. Secret name: `calendar/rds-connection`

6. Description: `RDS credentials for CloudNotes Calendar`

7. Click **Next** → **Next** → **Store**

8. Click into the secret → copy the **Secret ARN**
   (looks like `arn:aws:secretsmanager:ap-south-1:123456789:secret:calendar/rds-connection-xxxxx`)

### Step 8.2 — Give Lambda permission to read the secret

Your Lambda execution role needs permission to call `secretsmanager:GetSecretValue`.

1. IAM → **Roles** → find your Lambda role (e.g. `calendar-s3-logger-role-xxxx`)
2. **Add permissions** → **Create inline policy** → JSON:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "secretsmanager:GetSecretValue",
      "Resource": "arn:aws:secretsmanager:YOUR_REGION:YOUR_ACCOUNT:secret:calendar/rds-connection-*"
    }
  ]
}
```

Name it `SecretsManagerReadCalendarDB` → **Create policy**.

### Step 8.3 — Update EB to reference the secret (optional but demonstrates the concept)

For the API on Elastic Beanstalk, the simplest approach for a learning project is
to keep the connection string env var (which EB encrypts at rest) but update
`Program.cs` to optionally fetch from Secrets Manager if a secret ARN env var is set.

Add to EB environment variables:
- `AWS__SecretsManagerArn` = the Secret ARN from Step 8.1

Then in `Program.cs` or startup, add this code to optionally override the connection string:

```csharp
// In Program.cs, before builder.Build()
var secretArn = builder.Configuration["AWS:SecretsManagerArn"];
if (!string.IsNullOrEmpty(secretArn))
{
    // Fetch from Secrets Manager at startup
    var smClient = new Amazon.SecretsManager.AmazonSecretsManagerClient();
    var response = await smClient.GetSecretValueAsync(new Amazon.SecretsManager.Model.GetSecretValueRequest
    {
        SecretId = secretArn
    });
    var secret = System.Text.Json.JsonDocument.Parse(response.SecretString);
    var host = secret.RootElement.GetProperty("host").GetString();
    var username = secret.RootElement.GetProperty("username").GetString();
    var password = secret.RootElement.GetProperty("password").GetString();
    var connStr = $"Host={host};Port=5432;Database=calendardb;Username={username};Password={password};SSL Mode=Require;Trust Server Certificate=true";
    builder.Configuration["ConnectionStrings:DefaultConnection"] = connStr;
}
```

You'll need to add the NuGet package:
```
dotnet add package AWSSDK.SecretsManager
```

And give the EB EC2 role permission to read this secret (same inline policy as Step 8.2, applied to the EB EC2 role).

**Screenshot:** Secrets Manager showing `calendar/rds-connection` secret stored.

---

## PART 9 — DynamoDB table for logs/metadata

### What this means
DynamoDB is a serverless NoSQL database. You'll use it to store log entries or
metadata about uploaded files — logged by your Lambda function each time a file
is uploaded to S3.

### Step 9.1 — Create the DynamoDB table

1. AWS Console → search **DynamoDB** → **Create table**

| Setting | Value |
|---|---|
| Table name | `calendar-upload-logs` |
| Partition key | `id` (String) |
| Sort key | `timestamp` (String) |
| Table settings | Customize settings |
| Capacity mode | **On-demand** (free tier: 25 WCU/RCU, then pay per request) |

2. Click **Create table** — it's ready in seconds.

### Step 9.2 — Give Lambda write permission to DynamoDB

IAM → Lambda role (`calendar-sns-processor-role-xxxx`) → **Add permissions** → **Create inline policy** → JSON:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "dynamodb:PutItem",
        "dynamodb:GetItem",
        "dynamodb:Query"
      ],
      "Resource": "arn:aws:dynamodb:YOUR_REGION:YOUR_ACCOUNT:table/calendar-upload-logs"
    }
  ]
}
```

Name it `DynamoDBWriteCalendarLogs`.

### Step 9.3 — Update Lambda to write to DynamoDB

Update your `calendar-sns-processor` Lambda code:

```python
import json
import logging
import boto3
import uuid
from datetime import datetime, timezone

logger = logging.getLogger()
logger.setLevel(logging.INFO)

dynamodb = boto3.resource('dynamodb')
table = dynamodb.Table('calendar-upload-logs')

def lambda_handler(event, context):
    logger.info("SNS Lambda triggered. Records: %d", len(event.get("Records", [])))

    for record in event.get("Records", []):
        sns_message = record.get("Sns", {})
        message_str = sns_message.get("Message", "{}")

        try:
            message = json.loads(message_str)
            s3_records = message.get("Records", [])
            for s3_record in s3_records:
                bucket = s3_record.get("s3", {}).get("bucket", {}).get("name", "unknown")
                key = s3_record.get("s3", {}).get("object", {}).get("key", "unknown")
                size = s3_record.get("s3", {}).get("object", {}).get("size", 0)
                event_time = s3_record.get("eventTime", datetime.now(timezone.utc).isoformat())

                logger.info("File uploaded — Bucket: %s | Key: %s | Size: %d bytes", bucket, key, size)

                # Write to DynamoDB
                table.put_item(Item={
                    'id': str(uuid.uuid4()),
                    'timestamp': event_time,
                    'bucket': bucket,
                    'key': key,
                    'size': size,
                    'source': 'sns-s3-notification'
                })
                logger.info("Logged to DynamoDB successfully")

        except Exception as e:
            logger.error("Error processing record: %s", str(e))

    return {"statusCode": 200}
```

Click **Deploy**.

### Verify
1. Upload a file to S3 images bucket
2. DynamoDB → **Tables** → `calendar-upload-logs` → **Explore table items**
3. You should see a new item with bucket, key, size, and timestamp

**Screenshot:** DynamoDB table items showing logged upload entries.

---

## PART 10 — EventBridge scheduled Lambda

### What this means
EventBridge (formerly CloudWatch Events) can trigger a Lambda on a schedule —
like a cron job. You'll create a Lambda that runs every hour to summarize or
clean up data.

### Step 10.1 — Create the scheduled Lambda

1. Lambda → **Create function** → **Author from scratch**
2. Name: `calendar-scheduled-summary`
3. Runtime: **Python 3.12**
4. Execution role: **Create new role with basic Lambda permissions**
5. Create function

**Paste this code:**

```python
import json
import logging
import boto3
from datetime import datetime, timezone

logger = logging.getLogger()
logger.setLevel(logging.INFO)

dynamodb = boto3.resource('dynamodb')
table = dynamodb.Table('calendar-upload-logs')

def lambda_handler(event, context):
    now = datetime.now(timezone.utc)
    logger.info("Scheduled summary triggered at %s", now.isoformat())

    # Scan the DynamoDB table and count records
    try:
        response = table.scan(Select='COUNT')
        count = response.get('Count', 0)
        logger.info("Total upload log entries in DynamoDB: %d", count)
        logger.info("Summary complete. Timestamp: %s", now.isoformat())
    except Exception as e:
        logger.error("Error reading DynamoDB: %s", str(e))

    return {"statusCode": 200, "body": f"Summary complete at {now.isoformat()}"}
```

Click **Deploy**.

### Step 10.2 — Give it DynamoDB read permission

IAM → this Lambda's role → **Add permissions** → **Create inline policy**:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["dynamodb:Scan", "dynamodb:Query"],
      "Resource": "arn:aws:dynamodb:YOUR_REGION:YOUR_ACCOUNT:table/calendar-upload-logs"
    }
  ]
}
```

Name it `DynamoDBReadCalendarLogs`.

### Step 10.3 — Create the EventBridge schedule

1. AWS Console → search **EventBridge** → **Schedules** → **Create schedule**

2. Name: `calendar-hourly-summary`

3. Schedule pattern: **Recurring schedule** → **Rate-based schedule**
   - Rate: **1 hour**
   - (For testing, use 5 minutes: rate 5 minutes — change back after testing)

4. Click **Next**

5. Target: **Lambda function**

6. Lambda function: `calendar-scheduled-summary`

7. Click **Next** → review → **Create schedule**

### Verify
1. Wait for the schedule to fire (or temporarily set to 5-minute rate)
2. Lambda → `calendar-scheduled-summary` → **Monitor** → **View CloudWatch logs**
3. You should see log lines with the DynamoDB row count

**Screenshot:** EventBridge schedule showing `calendar-hourly-summary`, and CloudWatch logs showing it ran.

---

## PART 11 — IAM least privilege for Lambda

### What this means
Currently your Lambda roles may have broad permissions (e.g. `AWSLambdaSQSQueueExecutionRole`
grants access to all SQS queues). Least privilege means each role only has
the exact permissions it needs for the exact resources it uses.

### Review each Lambda's current permissions

For each Lambda (`calendar-s3-logger`, `calendar-sns-processor`, `calendar-scheduled-summary`):
1. Lambda → **Configuration** → **Permissions** → click the **role name**
2. Review all attached policies — note which ones are broad

### Replace broad policies with specific inline policies

#### Lambda: `calendar-s3-logger` (SQS → CloudWatch)

Remove: `AWSLambdaSQSQueueExecutionRole` (grants all SQS)
Replace with inline policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "sqs:ReceiveMessage",
        "sqs:DeleteMessage",
        "sqs:GetQueueAttributes"
      ],
      "Resource": "arn:aws:sqs:YOUR_REGION:YOUR_ACCOUNT:calendar-s3-events"
    },
    {
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ],
      "Resource": "arn:aws:logs:YOUR_REGION:YOUR_ACCOUNT:log-group:/aws/lambda/calendar-s3-logger:*"
    }
  ]
}
```

#### Lambda: `calendar-sns-processor` (SNS → DynamoDB → CloudWatch)

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["dynamodb:PutItem"],
      "Resource": "arn:aws:dynamodb:YOUR_REGION:YOUR_ACCOUNT:table/calendar-upload-logs"
    },
    {
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ],
      "Resource": "arn:aws:logs:YOUR_REGION:YOUR_ACCOUNT:log-group:/aws/lambda/calendar-sns-processor:*"
    }
  ]
}
```

#### Lambda: `calendar-scheduled-summary` (DynamoDB read → CloudWatch)

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["dynamodb:Scan"],
      "Resource": "arn:aws:dynamodb:YOUR_REGION:YOUR_ACCOUNT:table/calendar-upload-logs"
    },
    {
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ],
      "Resource": "arn:aws:logs:YOUR_REGION:YOUR_ACCOUNT:log-group:/aws/lambda/calendar-scheduled-summary:*"
    }
  ]
}
```

### How to apply
For each Lambda role:
1. IAM → role → **Add permissions** → **Create inline policy** → **JSON** tab
2. Paste the policy above → name it descriptively → **Create policy**
3. Then remove the old broad managed policy by clicking **X** next to it
4. Test the Lambda still works after tightening permissions

**Screenshot:** Lambda role showing only specific inline policies, no broad managed policies.

---

## PART 12 — CloudWatch Dashboard

### What this means
A dashboard gives you a single-screen view of your entire application's health —
EB CPU, RDS CPU, Lambda invocations, S3 requests, DynamoDB writes — all on one page.

### Steps

**12.1** CloudWatch → **Dashboards** → **Create dashboard**
- Name: `CloudNotes-Overview`
- Click **Create dashboard**

**12.2** A widget picker appears. Add these widgets one by one:

---

**Widget 1: EB CPU Utilization**
- Widget type: **Line**
- Data source: **Metrics**
- Click **Add metric** → **EC2** → **Per-Instance Metrics** → **CPUUtilization** → select your EB instance → **Create widget**

---

**Widget 2: RDS CPU Utilization**
- Widget type: **Line**
- **RDS** → **Per-Database Metrics** → **CPUUtilization** → `calendar-db` → **Create widget**

---

**Widget 3: RDS Database Connections**
- Widget type: **Number** (shows current count)
- **RDS** → **DatabaseConnections** → `calendar-db`

---

**Widget 4: Lambda Invocations (all 3 functions)**
- Widget type: **Line**
- **Lambda** → **Across All Functions** → **Invocations**
- Or add each function separately for clarity

---

**Widget 5: Lambda Errors**
- Widget type: **Line**
- **Lambda** → **Errors** → select all 3 Lambda functions

---

**Widget 6: DynamoDB Write Capacity**
- Widget type: **Line**
- **DynamoDB** → **Table Operation Metrics** → **SuccessfulRequestLatency** or **ConsumedWriteCapacityUnits** → `calendar-upload-logs`

---

**Widget 7: S3 Bucket Size (images bucket)**
- Widget type: **Number**
- **S3** → **Storage Metrics** → **BucketSizeBytes** → your images bucket → StorageType: StandardStorage

---

**Widget 8: Existing CPU Alarms status**
- Widget type: **Alarm status**
- Select your `rds-calendar-high-cpu` and `eb-calendar-high-cpu` alarms

---

**12.3** Arrange widgets by dragging them. Click **Save dashboard**.

**Screenshot:** Full dashboard showing all widgets.

---

## PART 13 — S3 bucket access logging

### What this means
S3 can record every request (GET, PUT, DELETE) made to a bucket into a separate
log bucket. Useful for auditing who accessed what files and when.

### Step 13.1 — Create a dedicated logs bucket

S3 → **Create bucket**
- Name: `calendar-access-logs-yourname-2026`
- Same region
- **Block all public access: ON** (logs should be private)
- Create

### Step 13.2 — Enable logging on images bucket

1. S3 → **images** bucket → **Properties** → **Server access logging** → **Edit**
2. Enable: ✅
3. Target bucket: `calendar-access-logs-yourname-2026`
4. Target prefix: `images-bucket/` (helps distinguish if you log multiple buckets)
5. Save changes

### Step 13.3 — Enable logging on static bucket

1. S3 → **static** bucket → **Properties** → **Server access logging** → **Edit**
2. Enable: ✅
3. Target bucket: `calendar-access-logs-yourname-2026`
4. Target prefix: `static-bucket/`
5. Save changes

### Verify
After a few requests to your buckets (open the website, upload a file), check:
S3 → `calendar-access-logs-yourname-2026` → you'll see log files appearing
under `images-bucket/` and `static-bucket/` prefixes within 1–2 hours.

Each log line shows: timestamp, requester IP, operation, object key, response code, bytes transferred.

**Screenshot:** Access logs bucket showing log files under each prefix.

---

## Complete advanced architecture diagram

```
Internet
   │
   ├──► S3 Static Bucket (React frontend)
   │         └── Access logs → S3 Logs Bucket
   │
   └──► ALB (Load Balancer)
            │
            ├──► EC2 instance 1 (EB, ap-south-1a)  ──► Auto Scaling Group (CPU trigger)
            └──► EC2 instance 2 (EB, ap-south-1b)        │
                      │                                   │ scale out > 70%
                      ├──► RDS PostgreSQL               scale in < 20%
                      │     (private subnet, Multi-AZ subnet group)
                      │     (Automated backups, 7-day retention)
                      │     (Credentials in Secrets Manager)
                      │
                      └──► S3 Images Bucket
                                │  (Versioning ON)
                                │  (Lifecycle: 30d→IA, 90d→Glacier)
                                │  (Access logs → S3 Logs Bucket)
                                │
                     ┌──────────┴───────────┐
                     │                      │
                    SQS                    SNS Topic
                     │                      │
                  Lambda 1              Lambda 2
               (calendar-s3-logger)  (calendar-sns-processor)
                     │                      │
               CloudWatch Logs        CloudWatch Logs
                                           │
                                      DynamoDB Table
                                    (calendar-upload-logs)
                                           │
                                      Lambda 3 (scheduled)
                                    (EventBridge every 1hr)
                                           │
                                      CloudWatch Logs

CloudWatch Dashboard: EB + RDS + Lambda + S3 + DynamoDB metrics
IAM: Least privilege roles per Lambda
```

---

## Work order for minimal disruption

Do these in order — each builds on the previous:

```
Part 1  → Verify AZs (quick check, no changes likely needed)
Part 3  → RDS backups (safe, no restart)
Part 4  → S3 versioning (instant, no downtime)
Part 5  → S3 lifecycle policy (instant, no downtime)
Part 13 → S3 access logging (instant, no downtime)
Part 6  → Add SNS notification to S3 (no downtime)
Part 7  → SNS Lambda (new function, no impact on existing)
Part 9  → DynamoDB table (instant)
Part 7  → Update Lambda to write to DynamoDB
Part 10 → EventBridge scheduled Lambda (new function)
Part 8  → Secrets Manager (store secret first, then optionally update API)
Part 2  → EB autoscaling — do this LAST as it restarts the environment
Part 11 → Tighten IAM roles (test each Lambda after tightening)
Part 12 → CloudWatch dashboard (purely additive, do anytime)
```

---

## Cost awareness

| Service | Advanced addition | Estimated cost |
|---|---|---|
| ALB (for autoscaling) | Required for load balanced tier | ~$16/month — **delete when done** |
| RDS backups | 7-day retention | Free up to DB storage size |
| S3 versioning | Extra object versions stored | Minimal for a learning project |
| Secrets Manager | 1 secret | Free 30 days, then $0.40/month |
| DynamoDB | On-demand, small table | Free tier covers 25GB + 25 WCU/RCU |
| EventBridge | Scheduled rules | Free (1M events/month free) |
| SNS | 1 topic, few messages | Free (1M publishes/month free) |
| S3 access logs | Extra storage | Minimal |

**Most important:** Delete the ALB/EB load balanced environment when done.
Switch back to Single instance tier to stop ALB charges.
