# Complete Secrets Audit for Enscribe API

## Overview

Your `.env.local` contains **26 environment variables**. Here's a comprehensive breakdown of which ones are needed for GitHub Secrets and how to categorize them.

---

## 📊 Secrets Categorization

### Category 1: AWS Credentials (NEEDS DIFFERENTIATION)

Currently, you have **one** AWS IAM user credentials, but you need **two separate sets**:

#### 1.1 EC2 Deployment IAM User (GitHub Actions)
For deploying to EC2 via GitHub Actions.

```
AWS_ACTIONS_ACCESS_KEY_ID
AWS_ACTIONS_SECRET_ACCESS_KEY
AWS_REGION
EC2_INSTANCE_ID
EC2_SECURITY_GROUP_ID
```

**Recommended IAM Policy:** `ec2:*`, `ssm:SendCommand`

#### 1.2 Comprehend Medical IAM User
For AWS Comprehend Medical API access (medical text analysis).

```
AWS_COMPREHEND_ACCESS_KEY_ID         ← RENAME from AWS_ACCESS_KEY_ID
AWS_COMPREHEND_SECRET_ACCESS_KEY     ← RENAME from AWS_SECRET_ACCESS_KEY
AWS_COMPREHEND_REGION                ← NEW (or reuse AWS_REGION if same)
```

**Recommended IAM Policy:** `comprehendmedical:*`

**Recommended Instance:** 
- **EC2 Instance Name:** `enscribe-api-prod`
- **IAM Role Name:** `enscribe-ec2-deployment`
- **Comprehend User Name:** `enscribe-comprehend-medical`

---

### Category 2: Google Cloud (GCP)

**Used for:** Gemini API, Cloud Run transcriber, VM management

```
CRITICAL SECRETS (Required):
  ✓ GCP_PROJECT_ID = emscribe-468812
  ✓ GCP_SERVICE_ACCOUNT_KEY = (entire JSON - base64 encode for GitHub)
  ✓ GEMINI_API_KEY = AIzaSy...

CONFIGURATION (Can be in GitHub Secrets or .env):
  ○ GCP_ZONE = us-central1-a
  ○ GCP_VM_INSTANCE_NAME = emscribe-c2d-32vcpux128gb
  ○ GCP_VM_RATE_LIMIT_MAX_CALLS = 3
  ○ GCP_VM_RATE_LIMIT_WINDOW_SEC = 60

SERVICE URLS:
  ○ CLOUD_RUN_TRANSCRIBE_URL = https://emscribe-transcriber-...
  ○ GEMINI_API_URL = https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent
```

---

### Category 3: OpenAI

**Used for:** ChatGPT-based API endpoints

```
CRITICAL SECRETS (Required):
  ✓ OPENAI_API_KEY = sk-proj-...

URLS (Can be hardcoded or configurable):
  ○ OPENAI_API_URL = https://api.openai.com/v1/chat/completions
```

---

### Category 4: Supabase

**Used for:** Database, authentication, file storage

```
CRITICAL SECRETS (Required):
  ✓ SUPABASE_URL = https://rwadtdxagmdqrygltzlv.supabase.co
  ✓ SUPABASE_ANON_KEY = eyJhbGc...
  ✓ SUPABASE_SERVICE_ROLE_KEY = eyJhbGc...
```

**Why renamed from NEXT_PUBLIC_?**
- Frontend (Next.js) is being deleted
- Only Fastify backend remains
- No need for `NEXT_PUBLIC_*` prefix anymore
- Cleaner naming for backend-only application

So:
- ✅ Renamed to `SUPABASE_URL` (backend-only)
- ✅ Renamed to `SUPABASE_ANON_KEY` (backend-only)
- ✅ Keep `SUPABASE_SERVICE_ROLE_KEY` secret (full permissions)

---

### Category 5: Authentication & Security

**Used for:** JWT tokens, session management, encryption

```
CRITICAL SECRETS (Required):
  ✓ RSA_PRIVATE_KEY = -----BEGIN PRIVATE KEY-----...
  ✓ RSA_PUBLIC_KEY = -----BEGIN PUBLIC KEY-----...
  ✓ REFRESH_TOKEN_AES_KEY_HEX = f81eb24...
  ✓ REFRESH_TOKEN_SIGNING_KEY_HEX = c5d80675...

CONFIGURATION (Can be in GitHub Secrets or .env):
  ○ REFRESH_COOKIE_DOMAIN = (empty for now)
  ○ REFRESH_COOKIE_SAMESITE = lax
  ○ REFRESH_COOKIE_SECURE = false
  ○ REFRESH_INACTIVITY_LIMIT_SECONDS = 260000
  ○ REFRESH_MAX_AGE_SECONDS = 260000
```

---

### Category 6: Development/Testing

**Used for:** Local testing only

```
NOT NEEDED IN PRODUCTION (local only):
  ✗ TEST_ACCOUNT_EMAIL = markvcyis@gmail.com
  ✗ TEST_ACCOUNT_PASSWORD = 123123123
  ✗ NODE_ENV = production (set in GitHub Actions workflow)
  ✗ CPU_THRESHOLD = 0.05 (optional, for GCP VM management)
```

---

## 🔐 Complete GitHub Secrets List

### REQUIRED (Must Add)

```
1. AWS_ACTIONS_ACCESS_KEY_ID
2. AWS_ACTIONS_SECRET_ACCESS_KEY
3. AWS_REGION
4. EC2_INSTANCE_ID
5. EC2_SECURITY_GROUP_ID

6. AWS_COMPREHEND_ACCESS_KEY_ID
7. AWS_COMPREHEND_SECRET_ACCESS_KEY

8. GCP_PROJECT_ID
9. GCP_SERVICE_ACCOUNT_KEY (base64-encoded JSON)
10. GEMINI_API_KEY

11. OPENAI_API_KEY

12. SUPABASE_URL
13. SUPABASE_ANON_KEY
14. SUPABASE_SERVICE_ROLE_KEY

15. RSA_PRIVATE_KEY
16. RSA_PUBLIC_KEY
17. REFRESH_TOKEN_AES_KEY_HEX
18. REFRESH_TOKEN_SIGNING_KEY_HEX
```

### OPTIONAL (Nice to Have)

```
19. GCP_ZONE (can default to us-central1-a)
20. GCP_VM_INSTANCE_NAME (can default to emscribe-c2d-32vcpux128gb)
21. GCP_VM_RATE_LIMIT_MAX_CALLS (can default to 3)
22. GCP_VM_RATE_LIMIT_WINDOW_SEC (can default to 60)
23. CLOUD_RUN_TRANSCRIBE_URL (can default to https://emscribe-transcriber-641824253036.us-central1.run.app/transcribe)
24. OPENAI_API_URL (can hardcode or use default)
25. GEMINI_API_URL (can hardcode or use default)
26. REFRESH_COOKIE_DOMAIN (can default to empty)
27. REFRESH_COOKIE_SAMESITE (can default to lax)
28. REFRESH_COOKIE_SECURE (can default to false)
29. REFRESH_INACTIVITY_LIMIT_SECONDS (can default to 260000)
30. REFRESH_MAX_AGE_SECONDS (can default to 260000)
31. CPU_THRESHOLD (can default to 0.05)
32. SLACK_WEBHOOK_URL (for notifications)
```

---

## 🔑 How to Prepare GCP_SERVICE_ACCOUNT_KEY for GitHub

The JSON is too large and contains newlines. Convert to base64:

```bash
# On Mac/Linux:
cat ~/path/to/service-account-key.json | base64 | pbcopy

# Or without pbcopy:
cat ~/path/to/service-account-key.json | base64

# Then in GitHub Actions workflow, decode it:
echo "${{ secrets.GCP_SERVICE_ACCOUNT_KEY }}" | base64 -d > /tmp/gcp-key.json
export GOOGLE_APPLICATION_CREDENTIALS=/tmp/gcp-key.json
```

---

## 📋 Secrets Summary Table

| Secret | Value | Location | Type | Production |
|--------|-------|----------|------|-----------|
| AWS_ACTIONS_ACCESS_KEY_ID | AKIA... | GitHub | Critical | ✅ |
| AWS_ACTIONS_SECRET_ACCESS_KEY | tnG... | GitHub | Critical | ✅ |
| AWS_REGION | us-east-1 | GitHub | Critical | ✅ |
| EC2_INSTANCE_ID | i-0abc... | GitHub | Critical | ✅ |
| EC2_SECURITY_GROUP_ID | sg-0abc... | GitHub | Critical | ✅ |
| AWS_COMPREHEND_ACCESS_KEY_ID | AKIA... | GitHub | Critical | ✅ |
| AWS_COMPREHEND_SECRET_ACCESS_KEY | (secret) | GitHub | Critical | ✅ |
| GCP_PROJECT_ID | emscribe-468812 | GitHub | Critical | ✅ |
| GCP_SERVICE_ACCOUNT_KEY | {...} | GitHub | Critical | ✅ |
| GEMINI_API_KEY | AIzaSy... | GitHub | Critical | ✅ |
| OPENAI_API_KEY | sk-proj... | GitHub | Critical | ✅ |
| SUPABASE_URL | https://... | GitHub | Critical | ✅ |
| SUPABASE_ANON_KEY | eyJ... | GitHub | Critical | ✅ |
| SUPABASE_SERVICE_ROLE_KEY | eyJ... | GitHub | Critical | ✅ |
| RSA_PRIVATE_KEY | -----BEGIN... | GitHub | Critical | ✅ |
| RSA_PUBLIC_KEY | -----BEGIN... | GitHub | Critical | ✅ |
| REFRESH_TOKEN_AES_KEY_HEX | f81eb... | GitHub | Critical | ✅ |
| REFRESH_TOKEN_SIGNING_KEY_HEX | c5d80... | GitHub | Critical | ✅ |
| GCP_ZONE | us-central1-a | .env | Optional | ⭕ |
| GCP_VM_INSTANCE_NAME | emscribe-c2d-32vcpux128gb | .env | Optional | ⭕ |
| GCP_VM_RATE_LIMIT_MAX_CALLS | 3 | .env | Optional | ⭕ |
| GCP_VM_RATE_LIMIT_WINDOW_SEC | 60 | .env | Optional | ⭕ |
| CLOUD_RUN_TRANSCRIBE_URL | https://... | .env | Optional | ⭕ |
| OPENAI_API_URL | https://... | .env | Optional | ⭕ |
| GEMINI_API_URL | https://... | .env | Optional | ⭕ |
| REFRESH_COOKIE_DOMAIN | (empty) | .env | Optional | ⭕ |
| REFRESH_COOKIE_SAMESITE | lax | .env | Optional | ⭕ |
| REFRESH_COOKIE_SECURE | false | .env | Optional | ⭕ |
| REFRESH_INACTIVITY_LIMIT_SECONDS | 260000 | .env | Optional | ⭕ |
| REFRESH_MAX_AGE_SECONDS | 260000 | .env | Optional | ⭕ |
| CPU_THRESHOLD | 0.05 | .env | Optional | ⭕ |

---

## 🎯 Action Items

### Step 1: Create Separate AWS IAM Users

**For EC2 Deployment:**
1. AWS Console → IAM → Users → Create user: `github-enscribe-deploy`
2. Attach policies:
   - `AmazonEC2FullAccess`
   - `AmazonSSMFullAccess` (for Systems Manager)
3. Generate access keys → Copy `Access Key ID` and `Secret Access Key`

**For Comprehend Medical:**
1. AWS Console → IAM → Users → Create user: `enscribe-comprehend-medical`
2. Attach policies:
   - `ComprehendMedicalFullAccess` (or custom policy)
3. Generate access keys → Copy values

### Step 2: Add All 18 Required Secrets to GitHub

```
Settings → Secrets and variables → Actions → New repository secret
```

Add each secret from the REQUIRED list above.

### Step 3: Update .env.local with Renamed Credentials

```bash
# Change AWS Comprehend credentials to avoid confusion:
AWS_ACCESS_KEY_ID           → AWS_COMPREHEND_ACCESS_KEY_ID
AWS_SECRET_ACCESS_KEY       → AWS_COMPREHEND_SECRET_ACCESS_KEY
```

### Step 4: Update Workflow to Use Correct Secrets

In `.github/workflows/deploy.yml`, update the AWS configuration section to use `AWS_ACTIONS_*` instead of generic `AWS_*`.

---

## 🔍 Why the Confusion?

**Your current setup:**
- One AWS IAM user doing TWO jobs:
  - Deploying to EC2 (GitHub Actions needs this)
  - Calling Comprehend Medical (application needs this)

**Better setup:**
- Two separate IAM users, each with minimal permissions
- GitHub Actions uses deployment user
- Application uses Comprehend Medical user
- If one key is compromised, only that service is affected

---

## ⚠️ Security Notes

1. **Never commit .env.local** - Already in .gitignore ✅
2. **GCP Service Account Key** - Contains private key, must be in GitHub Secrets
3. **RSA Private Key** - For JWT signing, must be in GitHub Secrets
4. **Refresh Token Keys** - For session management, must be in GitHub Secrets
5. **NEXT_PUBLIC keys** - Safe to be "public" (limited permissions)
6. **Service Role Key** - Full database access, must be secret (server-only)

---

## 📝 Next Steps

Would you like me to:

1. **Update the deploy.yml workflow** to use the new AWS secret names?
2. **Create a script** to help you set up the separate AWS IAM users?
3. **Update GITHUB_SECRETS.md** with the complete 18-secret list?
4. **Create a .env.production template** for production deployment?

Let me know which you'd like first!
