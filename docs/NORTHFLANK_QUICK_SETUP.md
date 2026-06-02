# Northflank Quick Setup Checklist

Based on the "Create new" service screen you're seeing:

## ✅ Step-by-Step Configuration

### 1. Basic Information
- **Service name**: `gastito` ✅ (already filled)
- **Tags**: (optional, skip for now)

### 2. Repository
- **Repository**: `gastonri/gastito` ✅ (already selected)
- **Branch**: `main` ✅ (already selected)

### 3. Build Options
- **Build type**: Select **"Dockerfile"** ⚠️ (IMPORTANT!)
  - Your project has a `Dockerfile` in the root
  - This gives you full control
  - Don't use "Buildpack Heroku" - it won't work well with Bun
- **Continuous Integration**: Enable ✅ (green toggle)

### 4. Resources
- **Compute plan**: `nf-compute-10` (Free tier - 0.1 shared vCPU, 256 MB Memory)
- **Instances**: `1`
- **Note**: Autoscaling is not available on free projects (that's fine)

### 5. Networking ⚠️ CRITICAL!
- Click **"Add port"**
- **Port**: `3000`
- **Protocol**: `HTTP`
- **Public**: ✅ Enable this (so Telegram can reach your webhook)

### 6. Environment Variables ⚠️ CRITICAL!
Click **"> Runtime variables"** and add these:

#### Required (copy-paste ready):
```
TELEGRAM_TOKEN=your_telegram_token_here
TELEGRAM_CHAT_ID=your_chat_id_here
GEMINI_API_KEY=your_gemini_key_here
GOOGLE_SHEETS_SPREADSHEET_ID=your_spreadsheet_id_here
GOOGLE_SERVICE_ACCOUNT_JSON={"type":"service_account",...}
REDIS_URL=redis://default:password@host:port
WEBHOOK_URL=https://gastito-xxxxx.northflank.app
```

**Note**: 
- `WEBHOOK_URL` - You'll get this after deployment, update it later
- `GOOGLE_SERVICE_ACCOUNT_JSON` - Paste the entire JSON as a single line
- `REDIS_URL` - Use Redis Protocol URL from Upstash (not REST URL)

#### Optional:
```
PORT=3000
NODE_ENV=production
GEMINI_MODEL_NAME=gemini-2.5-flash
DEFAULT_AI_PROVIDER=gemini
```

### 7. Advanced (Optional)
- **Health checks**: 
  - Click **"> Health checks"**
  - **Path**: `/healthz`
  - **Interval**: `30` seconds
  - **Timeout**: `10` seconds
  - **Initial delay**: `10` seconds

### 8. Create Service
- Click the blue **"Create service"** button
- Wait for build to complete (usually 2-5 minutes)

## After Deployment

1. **Get your service URL**:
   - Go to service dashboard
   - Copy the Public URL (format: `https://gastito-xxxxx.northflank.app`)

2. **Update WEBHOOK_URL**:
   - Go to Environment variables
   - Update `WEBHOOK_URL` to your actual service URL
   - Service will restart automatically

3. **Verify**:
   - Check logs for: `Server running on port 3000`
   - Check logs for: `Redis connected successfully`
   - Test: `https://your-service-url/healthz`

4. **Set Telegram webhook** (if not auto-set):
   ```bash
   curl https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://your-service-url/webhook
   ```

## Common Mistakes to Avoid

❌ **Don't select "Buildpack Heroku"** - Use "Dockerfile"  
❌ **Don't forget to add port 3000** and make it public  
❌ **Don't use REST URL for Redis** - Use Redis Protocol URL  
❌ **Don't forget to update WEBHOOK_URL** after getting your service URL  

## Need Help?

See [NORTHFLANK_DEPLOYMENT.md](./NORTHFLANK_DEPLOYMENT.md) for detailed troubleshooting.
