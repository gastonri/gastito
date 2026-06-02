# Render Deployment Guide

## Overview

This guide covers deploying Gastito to Render's free tier and keeping it awake using UptimeRobot to prevent the service from sleeping after 15 minutes of inactivity.

## Prerequisites

1. **Render account** (free tier) - Sign up at [render.com](https://render.com)
2. **UptimeRobot account** (free tier) - Sign up at [uptimerobot.com](https://uptimerobot.com)
3. **Git repository** - Your code must be in GitHub, GitLab, or Bitbucket

## Step 1: Deploy to Render

### Option A: Using render.yaml (Recommended)

1. **Push your code** to GitHub/GitLab/Bitbucket (if not already done)
2. **Log in** to [Render Dashboard](https://dashboard.render.com)
3. Click **"New +"** → **"Blueprint"**
4. **Connect your repository** (authorize Render if needed)
5. Render will automatically detect `render.yaml` and configure the service
6. **Review the configuration** and click **"Apply"**
7. **Set environment variables** in the Render dashboard (see Step 2 below)

### Option B: Manual Setup

1. **Log in** to [Render Dashboard](https://dashboard.render.com)
2. Click **"New +"** → **"Web Service"**
3. **Connect your Git repository** (authorize Render if needed)
4. **Configure the service:**
   - **Name**: `gastito`
   - **Environment**: `Node` (Render supports Bun through Node.js runtime)
   - **Region**: Choose closest to you (free tier available)
   - **Branch**: `main` (or your default branch)
   - **Root Directory**: Leave empty (or `.` if needed)
   - **Build Command**: `bun install`
   - **Start Command**: `bun run src/server.ts`
   - **Plan**: **Free**
5. Click **"Create Web Service"**
6. **Set environment variables** (see Step 2 below)

## Step 2: Configure Environment Variables

In Render dashboard → Your Service → **Environment**, add the following variables:

### Required Variables

- **`TELEGRAM_TOKEN`** - Your Telegram bot token (from [@BotFather](https://t.me/botfather))
- **`TELEGRAM_CHAT_ID`** - Your Telegram chat ID (for security)
- **`GEMINI_API_KEY`** - Google Gemini API key
- **`GOOGLE_SHEETS_SPREADSHEET_ID`** - Your Google Sheets spreadsheet ID
- **`GOOGLE_SERVICE_ACCOUNT_JSON`** - Full JSON string of your service account credentials (paste the entire JSON content, not a file path)
- **`WEBHOOK_URL`** - Your Render URL (e.g., `https://gastito.onrender.com`)

### Optional Variables

- **`PORT`** - Default: 3000 (Render sets this automatically, but good to have)
- **`NODE_ENV`** - Default: `production`
- **`GEMINI_MODEL_NAME`** - Default: `gemini-2.5-flash`
- **`DEFAULT_AI_PROVIDER`** - Default: `gemini` (or `anthropic`)
- **`ANTHROPIC_API_KEY`** - Required if using Anthropic Claude
- **`ANTHROPIC_MODEL_NAME`** - Default: `claude-haiku-4-5-20251001`

### Important Notes

- **`GOOGLE_SERVICE_ACCOUNT_JSON`**: This is different from `GOOGLE_APPLICATION_CREDENTIALS` (which is a file path). For Render, you need to paste the **entire JSON content** as a single string. The JSON should look like:
  ```json
  {"type":"service_account","project_id":"...","private_key":"...","client_email":"..."}
  ```
  - In Render dashboard: Just paste the JSON directly (Render handles it automatically)
  - The code will parse this JSON string automatically - no need to escape quotes
  - Make sure it's valid JSON (all on one line, or properly formatted)
- **`WEBHOOK_URL`**: Set this to your Render service URL. You'll get the URL after deployment (format: `https://your-service-name.onrender.com`).
- All sensitive variables should be marked as **"Secret"** in Render (they are by default when you paste them).

## Step 3: Set Up Keep-Awake with UptimeRobot

Render's free tier automatically spins down services after **15 minutes of inactivity**. To prevent this, we'll use UptimeRobot to ping the service regularly.

**Reference**: This setup is based on [this article](https://sergeiliski.medium.com/how-to-run-a-full-time-app-on-renders-free-tier-without-it-sleeping-bec26776d0b9) which explains how to keep Render services awake by doing actual work in health checks.

The `/healthz` endpoint is specifically designed for this purpose:
- It performs actual Redis I/O (ping) to force the service to wake up
- It does real computation to prevent edge caching
- It verifies service dependencies are active
- This ensures Render doesn't consider the service "idle"

### 3.1 Sign Up for UptimeRobot

1. Go to [uptimerobot.com](https://uptimerobot.com)
2. Sign up for a free account (allows 50 monitors)

### 3.2 Create a Monitor

1. **Log in** to UptimeRobot dashboard
2. Click **"Add New Monitor"**
3. **Configure the monitor:**
   - **Monitor Type**: Select **"HTTP(s)"**
   - **Friendly Name**: `Gastito Keep-Alive` (or any name you prefer)
   - **URL**: `https://your-service-name.onrender.com/healthz`
     - Replace `your-service-name` with your actual Render service name
   - **Monitoring Interval**: **5 minutes** (this is critical - must be less than 15 minutes)
   - **Alert Contacts**: (Optional) Set up email/SMS if you want notifications when the service is down
4. Click **"Create Monitor"**

### 3.3 Verify Monitor is Active

- The monitor should show as **"Up"** in the dashboard
- You can test it by clicking **"Test"** on the monitor
- UptimeRobot will now ping your `/healthz` endpoint every 5 minutes, keeping Render from considering the service idle
- The `/healthz` endpoint performs actual Redis I/O work, ensuring the service truly wakes up (not just edge cache hits)

## Step 4: Set Telegram Webhook

After deployment, set your Telegram webhook to point to your Render service:

### Option A: Automatic (if WEBHOOK_URL is set)

The webhook will be set automatically on server startup if `WEBHOOK_URL` is configured correctly.

### Option B: Manual

Run this command (replace `<YOUR_TELEGRAM_TOKEN>` and `<YOUR_RENDER_URL>`):

```bash
curl https://api.telegram.org/bot<YOUR_TELEGRAM_TOKEN>/setWebhook?url=https://your-service-name.onrender.com/webhook
```

Or visit this URL in your browser:
```
https://api.telegram.org/bot<YOUR_TELEGRAM_TOKEN>/setWebhook?url=https://your-service-name.onrender.com/webhook
```

### Verify Webhook

Check if webhook is set correctly:
```bash
curl https://api.telegram.org/bot<YOUR_TELEGRAM_TOKEN>/getWebhookInfo
```

## Step 5: Verify Deployment

1. **Check Render logs:**
   - Go to Render dashboard → Your Service → **"Logs"**
   - Look for: `Server running on port 3000`
   - Check for any errors

2. **Test health endpoints:**
   - Visit `https://your-service-name.onrender.com/health`
     - Should return: `{"status":"ok","timestamp":"..."}`
   - Visit `https://your-service-name.onrender.com/healthz`
     - Should return: `OK`

3. **Test Telegram bot:**
   - Send a message to your bot
   - Verify it responds correctly
   - Test image processing, audio transcription, etc.

4. **Monitor UptimeRobot:**
   - Check UptimeRobot dashboard
   - Verify monitor shows "Up" status
   - Check that pings are happening every 5 minutes

## Cost Breakdown

- **Render**: $0/month (free tier)
- **UptimeRobot**: $0/month (free tier - 50 monitors available)
- **Total Maintenance Cost**: **$0/month**

You only pay for:
- **AI API usage** (Gemini/Anthropic tokens) - varies based on usage
- **Google Sheets API usage** - usually free for personal use within quotas

## Troubleshooting

### Service Keeps Sleeping

**Symptoms**: Service takes 30+ seconds to respond after inactivity

**Solutions**:
- Verify UptimeRobot monitor is **active** and shows "Up" status
- Check that monitoring interval is set to **5 minutes** (not 30 minutes)
- Verify the URL in UptimeRobot is correct: `https://your-service.onrender.com/healthz`
- Check UptimeRobot logs to see if pings are successful
- Ensure `/healthz` endpoint returns `200 OK` (test manually in browser)

### Build Fails

**Symptoms**: Deployment fails during build phase

**Solutions**:
- Check Render logs for specific error messages
- Verify `bun install` completes successfully
- Ensure all dependencies are in `package.json`
- Check that `bun.lock` file is committed to repository
- Verify Bun is available in Render (should be automatic)

### Webhook Not Working

**Symptoms**: Bot doesn't respond to messages

**Solutions**:
- Verify `WEBHOOK_URL` environment variable is set correctly in Render
- Check that the URL is publicly accessible (test `/healthz` endpoint)
- Verify webhook is set: `curl https://api.telegram.org/bot<TOKEN>/getWebhookInfo`
- Check Render logs for webhook-related errors
- Ensure `TELEGRAM_TOKEN` is correct
- Test webhook manually with curl command

### Environment Variables Not Loading

**Symptoms**: Service starts but fails with "Missing required environment variable"

**Solutions**:
- Verify all required variables are set in Render dashboard
- Check for typos in variable names (case-sensitive)
- Ensure `GOOGLE_SERVICE_ACCOUNT_JSON` is the full JSON string (not a file path)
- Check Render logs for specific missing variable errors
- Verify variables are marked as "Secret" if needed (Render does this automatically)

### Service Crashes on Startup

**Symptoms**: Service deploys but immediately crashes

**Solutions**:
- Check Render logs for error messages
- Verify all required environment variables are set
- Ensure `GOOGLE_SERVICE_ACCOUNT_JSON` is valid JSON
- Check that `TELEGRAM_CHAT_ID` is a valid number
- Verify Google Sheets API is enabled for your service account
- Test configuration locally first

### Slow Response Times

**Symptoms**: Bot responds but takes a long time

**Solutions**:
- This is normal for free tier - first request after sleep can take 30-60 seconds
- Subsequent requests should be faster
- If consistently slow, check Render logs for errors
- Verify UptimeRobot is keeping service awake (check monitor status)

## Additional Tips

1. **Monitor Render Logs**: Keep an eye on logs during initial deployment to catch issues early

2. **Test Locally First**: Always test configuration locally before deploying:
   ```bash
   bun install
   bun run src/server.ts
   ```

3. **Backup Configuration**: Keep a record of all environment variables (in a secure password manager)

4. **Update WEBHOOK_URL**: If you change the service name or URL, remember to update `WEBHOOK_URL` environment variable

5. **UptimeRobot Alerts**: Set up email alerts in UptimeRobot to be notified if the service goes down

6. **Render Auto-Deploy**: Render automatically deploys on git push to the connected branch (can be disabled in settings)

## Migration from Fly.io

If you're migrating from Fly.io:

1. Keep your `fly.toml` file for reference
2. Export environment variables from Fly.io:
   ```bash
   fly secrets list -a gastito
   ```
3. Set them in Render dashboard
4. Update `WEBHOOK_URL` to your new Render URL
5. Test thoroughly before removing Fly.io deployment
6. Update Telegram webhook to point to Render

## Support

- **Render Documentation**: [render.com/docs](https://render.com/docs)
- **UptimeRobot Documentation**: [uptimerobot.com/api](https://uptimerobot.com/api)
- **Bun Documentation**: [bun.sh/docs](https://bun.sh/docs)

