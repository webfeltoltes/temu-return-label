require("dotenv").config();

const axios = require("axios");
const crypto = require("crypto");

const {
  TEMU_APP_KEY,
  TEMU_APP_SECRET,
  TEMU_ACCESS_TOKEN,
  TEMU_API_URL = "https://openapi-b-eu.temu.com/openapi/router",
} = process.env;

const PARENT_ORDER_SN = "PO-090-12329685781113212";
const PARENT_AFTER_SALES_SN = "PO-090-12329685781113212-D01";

function signValue(value) {
  if (value === null || value === undefined) return "";

  if (typeof value === "object") {
    return JSON.stringify(value);
  }

  return String(value);
}

function makeSign(params, appSecret) {
  const sortedKeys = Object.keys(params)
    .filter(
      (key) =>
        key !== "sign" &&
        params[key] !== undefined &&
        params[key] !== null
    )
    .sort();

  let signStr = appSecret;

  for (const key of sortedKeys) {
    signStr += key + signValue(params[key]);
  }

  signStr += appSecret;

  return crypto
    .createHash("md5")
    .update(signStr, "utf8")
    .digest("hex")
    .toUpperCase();
}

async function callTemu(type, payload = {}) {
  if (!TEMU_APP_KEY || !TEMU_APP_SECRET || !TEMU_ACCESS_TOKEN) {
    throw new Error(
      "Hiányzik TEMU_APP_KEY / TEMU_APP_SECRET / TEMU_ACCESS_TOKEN a .env fájlból."
    );
  }

  const params = {
    type,
    app_key: TEMU_APP_KEY,
    access_token: TEMU_ACCESS_TOKEN,
    timestamp: Math.floor(Date.now() / 1000),
    data_type: "JSON",
    ...payload,
  };

  params.sign = makeSign(params, TEMU_APP_SECRET);

  const response = await axios.post(TEMU_API_URL, params, {
    headers: {
      "Content-Type": "application/json",
    },
    timeout: 30000,
  });

  return response.data;
}

function collectPossibleCarrierRows(obj, rows = []) {
  if (!obj || typeof obj !== "object") return rows;

  if (Array.isArray(obj)) {
    for (const item of obj) {
      collectPossibleCarrierRows(item, rows);
    }

    return rows;
  }

  const keys = Object.keys(obj);
  const joined = JSON.stringify(obj).toLowerCase();

  const looksLikeCarrier =
    joined.includes("packeta") ||
    joined.includes("zasilkovna") ||
    joined.includes("zásilkovna") ||
    joined.includes("packet") ||
    joined.includes("carrier") ||
    joined.includes("logistics");

  if (looksLikeCarrier && keys.length <= 20) {
    rows.push(obj);
  }

  for (const value of Object.values(obj)) {
    if (value && typeof value === "object") {
      collectPossibleCarrierRows(value, rows);
    }
  }

  return rows;
}

async function main() {
  console.log("Temu carrier lista teszt");
  console.log("parentOrderSn:", PARENT_ORDER_SN);
  console.log("parentAfterSalesSn:", PARENT_AFTER_SALES_SN);
  console.log("----------");

  const payloadVariants = [
    {
      name: "empty",
      payload: {},
    },
    {
      name: "with_parent_order",
      payload: {
        parentOrderSn: PARENT_ORDER_SN,
      },
    },
    {
      name: "with_aftersales",
      payload: {
        parentOrderSn: PARENT_ORDER_SN,
        parentAfterSalesSn: PARENT_AFTER_SALES_SN,
      },
    },
    {
      name: "with_country_hu",
      payload: {
        parentOrderSn: PARENT_ORDER_SN,
        parentAfterSalesSn: PARENT_AFTER_SALES_SN,
        countryCode: "HU",
      },
    },
    {
      name: "with_region_hu",
      payload: {
        parentOrderSn: PARENT_ORDER_SN,
        parentAfterSalesSn: PARENT_AFTER_SALES_SN,
        regionCode: "HU",
      },
    },
  ];

  for (const variant of payloadVariants) {
    console.log("Próba:", variant.name);
    console.log("Payload:");
    console.log(JSON.stringify(variant.payload, null, 2));

    try {
      const response = await callTemu(
        "temu.aftersales.carrier.get",
        variant.payload
      );

      console.log("Válasz:");
      console.log(JSON.stringify(response, null, 2));

      const possibleRows = collectPossibleCarrierRows(response);

      if (possibleRows.length > 0) {
        console.log("Lehetséges carrier sorok:");
        console.log(JSON.stringify(possibleRows, null, 2));
      }

      console.log("----------");
    } catch (error) {
      console.log("Hiba ennél a változatnál:", variant.name);

      if (error.response) {
        console.log("HTTP status:", error.response.status);
        console.log(error.response.data);
      } else {
        console.log(error.message);
      }

      console.log("----------");
    }
  }
}

main().catch((error) => {
  console.error("Temu carrier teszt hiba:");

  if (error.response) {
    console.error("HTTP status:", error.response.status);
    console.error(error.response.data);
    return;
  }

  console.error(error.message);
});