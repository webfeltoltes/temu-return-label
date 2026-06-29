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

function collectRows(obj, rows = []) {
  if (!obj || typeof obj !== "object") return rows;

  if (Array.isArray(obj)) {
    for (const item of obj) {
      collectRows(item, rows);
    }

    return rows;
  }

  const keys = Object.keys(obj);
  const text = JSON.stringify(obj).toLowerCase();

  const looksUseful =
    text.includes("packeta") ||
    text.includes("zasilkovna") ||
    text.includes("zásilkovna") ||
    text.includes("packet") ||
    text.includes("carrier") ||
    text.includes("logistics") ||
    text.includes("provider") ||
    text.includes("service") ||
    text.includes("shipping") ||
    text.includes("express") ||
    text.includes("gls") ||
    text.includes("dpd") ||
    text.includes("dhl") ||
    text.includes("ups");

  if (looksUseful && keys.length <= 40) {
    rows.push(obj);
  }

  for (const value of Object.values(obj)) {
    if (value && typeof value === "object") {
      collectRows(value, rows);
    }
  }

  return rows;
}

async function main() {
  console.log("Temu carrier lista teszt - request wrapper verzió");
  console.log("parentOrderSn:", PARENT_ORDER_SN);
  console.log("parentAfterSalesSn:", PARENT_AFTER_SALES_SN);
  console.log("----------");

  console.log("1. Return label prepare lekérés...");

  const prepareResponse = await callTemu(
    "temu.aftersales.returnlabel.prepare.get",
    {
      parentOrderSn: PARENT_ORDER_SN,
      parentAfterSalesSn: PARENT_AFTER_SALES_SN,
    }
  );

  console.log(JSON.stringify(prepareResponse, null, 2));
  console.log("----------");

  const returnWarehouseId =
    prepareResponse?.result?.availableReturnWarehouseList?.[0]?.warehouseId ||
    null;

  console.log("returnWarehouseId:", returnWarehouseId || "-");
  console.log("----------");

  const baseRequest = {
    parentOrderSn: PARENT_ORDER_SN,
    parentAfterSalesSn: PARENT_AFTER_SALES_SN,
    returnWarehouseId,
    countryCode: "HU",
  };

  const minimalRequest = {
    parentAfterSalesSn: PARENT_AFTER_SALES_SN,
    returnWarehouseId,
  };

  const payloadVariants = [
    {
      name: "request_base",
      payload: {
        request: baseRequest,
      },
    },
    {
      name: "request_minimal",
      payload: {
        request: minimalRequest,
      },
    },
    {
      name: "request_with_warehouseId",
      payload: {
        request: {
          parentOrderSn: PARENT_ORDER_SN,
          parentAfterSalesSn: PARENT_AFTER_SALES_SN,
          warehouseId: returnWarehouseId,
          countryCode: "HU",
        },
      },
    },
    {
      name: "request_only_aftersales",
      payload: {
        request: {
          parentAfterSalesSn: PARENT_AFTER_SALES_SN,
        },
      },
    },
    {
      name: "request_only_warehouse",
      payload: {
        request: {
          returnWarehouseId,
        },
      },
    },
    {
      name: "carrierGetRequest_base",
      payload: {
        carrierGetRequest: baseRequest,
      },
    },
    {
      name: "carrierGetRequest_minimal",
      payload: {
        carrierGetRequest: minimalRequest,
      },
    },
    {
      name: "carrierQueryRequest_base",
      payload: {
        carrierQueryRequest: baseRequest,
      },
    },
    {
      name: "carrierQueryRequest_minimal",
      payload: {
        carrierQueryRequest: minimalRequest,
      },
    },
    {
      name: "param_base",
      payload: {
        param: baseRequest,
      },
    },
    {
      name: "input_base",
      payload: {
        input: baseRequest,
      },
    },
  ].map((variant) => {
    function clean(obj) {
      if (!obj || typeof obj !== "object") return obj;

      const cleaned = {};

      for (const [key, value] of Object.entries(obj)) {
        if (value === null || value === undefined || value === "") continue;

        if (typeof value === "object" && !Array.isArray(value)) {
          cleaned[key] = clean(value);
        } else {
          cleaned[key] = value;
        }
      }

      return cleaned;
    }

    return {
      name: variant.name,
      payload: clean(variant.payload),
    };
  });

  console.log("2. Carrier lista próbák...");
  console.log("----------");

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

      const rows = collectRows(response);

      if (rows.length > 0) {
        console.log("Lehetséges carrier sorok:");
        console.log(JSON.stringify(rows, null, 2));
      }

      if (response?.success === true || response?.errorCode === 1000000) {
        console.log("SIKERES carrier.get változat:", variant.name);
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