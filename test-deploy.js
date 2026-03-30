const axios = require("axios");

const BASE_URL = "http://localhost:3000"; // of jouw App Runner URL
const API_KEY = process.env.PROVISIONING_API_KEY;

if (!API_KEY) {
  console.error("❌ Missing PROVISIONING_API_KEY env var");
  process.exit(1);
}

async function run() {
  try {
    const payload = {
      customerId: "cust_test_001",
      projectName: "vedantix-test-project-1",
      domain: "test1.vedantix.nl",
      packageCode: "STARTER",
      addOns: []
    };

    console.log("🚀 Sending deploy request...\n");

    const response = await axios.post(`${BASE_URL}/api/deploy`, payload, {
      headers: {
        "x-api-key": API_KEY
      }
    });

    console.log("✅ RESPONSE:");ß
    console.dir(response.data, { depth: null });

    return response.data;
  } catch (err) {
    console.error("❌ ERROR:");
    if (err.response) {
      console.error(err.response.status, err.response.data);
    } else {
      console.error(err.message);
    }
  }
}

run();