require("dotenv").config();

const express = require("express");
const axios = require("axios");
const crypto = require("crypto");

const app = express();
app.use(express.json({ limit: "10mb" }));

const {
  TEMU_APP_KEY,
  TEMU_APP_SECRET,
  TEMU_ACCESS_TOKEN,
  TEMU_API_URL = "https://openapi-b-eu.temu.com/openapi/router",
  PORT = 3000,
} = process.env;

function makeSign(params, appSecret) {
  const sortedKeys = Object.keys(params)
    .filter((key) => {
      const value = params[key];
      return value !== undefined && value !== null && value !== "";
    })
    .sort();

  let signStr = appSecret;

  for (const key of sortedKeys) {
    signStr += key + params[key];
  }

  signStr += appSecret;

  return crypto
    .createHash("md5")
    .update(signStr, "utf8")
    .digest("hex")
    .toUpperCase();
}

async function callTemu(type, payload = {}, accessToken = TEMU_ACCESS_TOKEN) {
  const timestamp = Math.floor(Date.now() / 1000).toString();

  const params = {
    type,
    app_key: TEMU_APP_KEY,
    access_token: accessToken,
    timestamp,
    data_type: "JSON",
    ...payload,
  };

  params.sign = makeSign(params, TEMU_APP_SECRET);

  const response = await axios.post(TEMU_API_URL, params, {
    headers: {
      "content-type": "application/json",
    },
    timeout: 30000,
  });

  return response.data;
}

app.get("/", (req, res) => {
  res.send(`
    <h2>Temu return_label app működik.</h2>

    <p>Token teszt:</p>
    <code>/temu/token-info</code>

    <p>Aftersales teszt:</p>
    <code>/temu/aftersales-test</code>

    <p>Callback URL:</p>
    <code>/temu/callback?code=TESZT</code>

    <p>Webhook endpoint:</p>
    <code>/temu/webhook</code>
  `);
});

app.get("/temu/callback", async (req, res) => {
  const code = req.query.code;

  if (!code) {
    return res.status(400).send("Nincs code paraméter az URL-ben.");
  }

  console.log("Temu authorization code érkezett:");
  console.log(code);

  try {
    const result = await callTemu(
      "bg.open.accesstoken.create",
      { code },
      code
    );

    console.log("Access token válasz:");
    console.dir(result, { depth: null });

    res.json({
      message: "Sikeres Temu authorization callback.",
      note: "Az accessToken értéket mentsd el biztonságosan.",
      result,
    });
  } catch (error) {
    console.error("Token lekérés hiba:");

    if (error.response) {
      console.error("HTTP status:", error.response.status);
      console.dir(error.response.data, { depth: null });

      return res.status(500).json({
        message: "Temu token lekérés hiba.",
        status: error.response.status,
        data: error.response.data,
      });
    }

    console.error(error.message);

    res.status(500).json({
      message: "Temu token lekérés hiba.",
      error: error.message,
    });
  }
});

app.get("/temu/token-info", async (req, res) => {
  try {
    const result = await callTemu("bg.open.accesstoken.info.get");

    res.json(result);
  } catch (error) {
    console.error("Token info hiba:");

    if (error.response) {
      console.error("HTTP status:", error.response.status);
      console.dir(error.response.data, { depth: null });

      return res.status(500).json({
        message: "Temu token info hiba.",
        status: error.response.status,
        data: error.response.data,
      });
    }

    console.error(error.message);

    res.status(500).json({
      message: "Temu token info hiba.",
      error: error.message,
    });
  }
});

app.get("/temu/aftersales-test", async (req, res) => {
  try {
    const now = Math.floor(Date.now() / 1000);
    const thirtyDaysAgo = now - 30 * 24 * 60 * 60;

    const result = await callTemu("bg.aftersales.parentaftersales.list.get", {
      pageNo: 1,
      pageSize: 20,
      updateAtStart: thirtyDaysAgo,
      updateAtEnd: now,
    });

    const allData = result?.result?.data || [];

    const labelNeeded = allData.filter((item) => {
      return item.parentAfterSalesStatus === 8;
    });

    res.json({
      success: result.success,
      requestId: result.requestId,
      errorCode: result.errorCode,
      errorMsg: result.errorMsg,
      totalFromTemu: result?.result?.total || 0,
      pageNumber: result?.result?.pageNumber || 1,
      returnedCount: allData.length,
      labelNeededCount: labelNeeded.length,
      labelNeeded,
      allData,
    });
  } catch (error) {
    console.error("Aftersales lista hiba:");

    if (error.response) {
      console.error("HTTP status:", error.response.status);
      console.dir(error.response.data, { depth: null });

      return res.status(500).json({
        message: "Temu aftersales lista hiba.",
        status: error.response.status,
        data: error.response.data,
      });
    }

    console.error(error.message);

    res.status(500).json({
      message: "Temu aftersales lista hiba.",
      error: error.message,
    });
  }
});

app.post("/temu/webhook", async (req, res) => {
  console.log("Temu webhook érkezett");
  console.log("Headers:", req.headers);
  console.log("Body:", req.body);

  res.status(200).json({
    result: {},
  });
});

app.listen(PORT, () => {
  console.log(`Server fut: http://localhost:${PORT}`);
});