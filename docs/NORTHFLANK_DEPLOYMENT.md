# Northflank Deployment Guide

## Overview

This guide covers deploying Gastito Bot to Northflank's free tier. Northflank's free tier **does not sleep**, so you don't need UptimeRobot or keep-alive pings!

## Prerequisites

1. **Northflank account** (free tier) - Sign up at [northflank.com](https://northflank.com)
2. **Git repository** - Your code must be in GitHub, GitLab, or Bitbucket
3. **Upstash Redis** (or any Redis instance) - For session management

## Step 1: Deploy to Northflank

### 1.1 Create New Service

1. **Log in** to [Northflank Dashboard](https://app.northflank.com)
2. Click **"Create new"** → **"Service"**
3. Select **"Build and deploy a Git repo"** (Combined service)
4. Choose your repository: `gastonri/gastito`
5. Select branch: `main`

### 1.2 Configure Build Options

**Build type**: Select **"Dockerfile"**
- Your project already has a `Dockerfile` that uses Bun
- This gives full control over the build process
- Northflank will automatically detect and use your Dockerfile

**Continuous Integration**: Enable CI (green toggle)
- This will automatically build and deploy on every push to `main`

### 1.3 Configure Resources

**Compute plan**: Select `nf-compute-10` (Free tier)
- 0.1 shared vCPU
- 256 MB Memory
- This is sufficient for the bot

**Instances**: Set to `1`

### 1.4 Configure Networking

**Ports**: Add a port
- **Port**: `3000`
- **Protocol**: `HTTP`
- **Public**: Enable (so Telegram can reach your webhook)

### 1.5 Configure Environment Variables

Click **"> Runtime variables"** and add:

#### Required Variables

- **`TELEGRAM_TOKEN`** - Your Telegram bot token (from [@BotFather](https://t.me/botfather))
- **`TELEGRAM_CHAT_ID`** - Your Telegram chat ID (for security)
- **`GEMINI_API_KEY`** - Google Gemini API key
- **`GOOGLE_SHEETS_SPREADSHEET_ID`** - Your Google Sheets spreadsheet ID
- **`GOOGLE_SERVICE_ACCOUNT_JSON`** - Full JSON string of your service account credentials
- **`REDIS_URL`** - Your Redis connection URL (e.g., Upstash Redis URL)
- **`WEBHOOK_URL`** - Your Northflank service URL (will be `https://gastito-xxxxx.northflank.app`)

#### Optional Variables

- **`PORT`** - Default: `3000` (Northflank sets this automatically)
- **`NODE_ENV`** - Set to `production`
- **`GEMINI_MODEL_NAME`** - Default: `gemini-2.5-flash`
- **`DEFAULT_AI_PROVIDER`** - Default: `gemini` (or `anthropic`)
- **`ANTHROPIC_API_KEY`** - Required if using Anthropic Claude
- **`ANTHROPIC_MODEL_NAME`** - Default: `claude-haiku-4-5-20251001`

### 1.6 Advanced Configuration

**Health checks** (optional but recommended):
- **Path**: `/healthz`
- **Interval**: `30` seconds
- **Timeout**: `10` seconds
- **Initial delay**: `10` seconds

**Docker runtime mode**: Keep as "Default configuration"

### 1.7 Create Service

Click **"Create service"** and wait for the build to complete.

## Step 2: Get Your Service URL

After deployment:

1. Go to your service dashboard
2. Find the **Public URL** (format: `https://gastito-xxxxx.northflank.app`)
3. Copy this URL - you'll need it for `WEBHOOK_URL`

## Step 3: Update Environment Variables

1. Go to your service → **"Environment variables"**
2. Update **`WEBHOOK_URL`** to your actual service URL:
   ```
   WEBHOOK_URL=https://gastito-xxxxx.northflank.app
   ```
3. The service will automatically restart with the new variable

## Step 4: Set Telegram Webhook

After deployment, set your Telegram webhook to point to your Northflank service:

### Option A: Automatic (if WEBHOOK_URL is set)

The webhook will be set automatically on server startup if `WEBHOOK_URL` is configured correctly.

### Option B: Manual

Run this command (replace `<YOUR_TELEGRAM_TOKEN>` and `<YOUR_NORTHFLANK_URL>`):

```bash
curl https://api.telegram.org/bot<YOUR_TELEGRAM_TOKEN>/setWebhook?url=https://gastito-xxxxx.northflank.app/webhook
```

Or visit this URL in your browser:
```
https://api.telegram.org/bot<YOUR_TELEGRAM_TOKEN>/setWebhook?url=https://gastito-xxxxx.northflank.app/webhook
```

### Verify Webhook

Check if webhook is set correctly:
```bash
curl https://api.telegram.org/bot<YOUR_TELEGRAM_TOKEN>/getWebhookInfo
```

## Step 5: Verify Deployment

1. **Check Northflank logs:**
   - Go to your service → **"Logs"**
   - Look for: `Server running on port 3000`
   - Look for: `Redis connected successfully`
   - Check for any errors

2. **Test health endpoints:**
   - Visit `https://gastito-xxxxx.northflank.app/health`
     - Should return: `{"status":"ok","timestamp":"..."}`
   - Visit `https://gastito-xxxxx.northflank.app/healthz`
     - Should return: `{"status":"ok",...,"redis":true,...}`

3. **Test Telegram bot:**
   - Send a message to your bot
   - Verify it responds correctly
   - Test image processing, audio transcription, etc.

## Cost Breakdown

- **Northflank**: $0/month (free tier - no sleep!)
- **Upstash Redis**: $0/month (free tier available)
- **Total Maintenance Cost**: **$0/month**

You only pay for:
- **AI API usage** (Gemini/Anthropic tokens) - varies based on usage
- **Google Sheets API usage** - usually free for personal use within quotas

## Advantages of Northflank Free Tier

✅ **No sleep** - Service stays awake 24/7  
✅ **No need for UptimeRobot** - No keep-alive pings required  
✅ **Automatic deployments** - CI/CD on git push  
✅ **Health checks** - Built-in monitoring  
✅ **Free SSL** - HTTPS automatically configured  

## Troubleshooting

### Build Fails

**Symptoms**: Deployment fails during build phase

**Solutions**:
- Check Northflank logs for specific error messages
- Verify `Dockerfile` is in the root directory
- Ensure `bun.lock` file is committed to repository
- Check that all dependencies are in `package.json`
- Verify Dockerfile uses correct base image: `oven/bun:1-alpine`

### Service Crashes on Startup

**Symptoms**: Service deploys but immediately crashes

**Solutions**:
- Check Northflank logs for error messages
- Verify all required environment variables are set
- Ensure `GOOGLE_SERVICE_ACCOUNT_JSON` is valid JSON
- Check that `TELEGRAM_CHAT_ID` is a valid number
- Verify Google Sheets API is enabled for your service account
- Verify `REDIS_URL` is correct and Redis is accessible
- Test configuration locally first

### Webhook Not Working

**Symptoms**: Bot doesn't respond to messages

**Solutions**:
- Verify `WEBHOOK_URL` environment variable is set correctly
- Check that the URL is publicly accessible (test `/healthz` endpoint)
- Verify webhook is set: `curl https://api.telegram.org/bot<TOKEN>/getWebhookInfo`
- Check Northflank logs for webhook-related errors
- Ensure `TELEGRAM_TOKEN` is correct
- Verify port 3000 is exposed and public

### Redis Connection Fails

**Symptoms**: Service starts but Redis connection errors appear

**Solutions**:
- Verify `REDIS_URL` is correct (use Redis Protocol URL, not REST URL)
- Check that Redis instance is accessible from Northflank
- For Upstash: Use the Redis Protocol URL (not REST URL)
- Test Redis connection locally first
- Check Northflank logs for specific Redis error messages

### Environment Variables Not Loading

**Symptoms**: Service starts but fails with "Missing required environment variable"

**Solutions**:
- Verify all required variables are set in Northflank dashboard
- Check for typos in variable names (case-sensitive)
- Ensure `GOOGLE_SERVICE_ACCOUNT_JSON` is the full JSON string (not a file path)
- Check Northflank logs for specific missing variable errors
- Verify variables are saved (click "Save" after adding)

## Migration from Render

If you're migrating from Render:

1. Export environment variables from Render dashboard
2. Set them in Northflank dashboard
3. Update `WEBHOOK_URL` to your new Northflank URL
4. Test thoroughly before removing Render deployment
5. Update Telegram webhook to point to Northflank
6. **Remove UptimeRobot monitor** (not needed on Northflank!)

## Support

- **Northflank Documentation**: [docs.northflank.com](https://docs.northflank.com)
- **Bun Documentation**: [bun.sh/docs](https://bun.sh/docs)
