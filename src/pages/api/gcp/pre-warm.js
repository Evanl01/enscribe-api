import { google } from 'googleapis';

let lastCalls = {}; // Simple in-memory rate limit tracker

async function getComputeClient() {
  const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(process.env.GCP_SERVICE_ACCOUNT_KEY),
    scopes: ['https://www.googleapis.com/auth/cloud-platform'],
  });
  return google.compute({ version: 'v1', auth });
}

async function getVMStatus(compute) {
  const res = await compute.instances.get({
    project: process.env.GCP_PROJECT_ID,
    zone: process.env.GCP_ZONE,
    instance: process.env.INSTANCE_NAME,
  });
  return res.data.status; // e.g., RUNNING, TERMINATED, PROVISIONING
}

async function startVM(compute) {
  return await compute.instances.start({
    project: process.env.GCP_PROJECT_ID,
    zone: process.env.GCP_ZONE,
    instance: process.env.INSTANCE_NAME,
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const userIP = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

  // 1️⃣ Basic rate limiting per IP
  const now = Date.now();
  if (!lastCalls[userIP]) lastCalls[userIP] = [];
  lastCalls[userIP] = lastCalls[userIP].filter(ts => now - ts < process.env.RATE_LIMIT_WINDOW_SEC * 1000);
  if (lastCalls[userIP].length >= process.env.RATE_LIMIT_MAX_CALLS) {
    return res.status(429).json({ error: 'Too many pre-warm requests' });
  }
  lastCalls[userIP].push(now);

  try {
    const compute = await getComputeClient();

    // 2️⃣ Check VM status
    const status = await getVMStatus(compute);
    console.log(`VM status: ${status}`);

    if (status === 'RUNNING' || status === 'PROVISIONING' || status === 'STAGING') {
      return res.status(200).json({ message: `VM is already ${status}` });
    }

    // 3️⃣ Start VM
    await startVM(compute);
    return res.status(200).json({ message: 'VM starting...' });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to pre-warm VM' });
  }
}
