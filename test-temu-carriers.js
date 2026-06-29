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

function cleanObject(obj) {
  if (!obj || typeof obj !== "object") return obj;

  if (Array.isArray(obj)) {
    return obj
      .map((item) => cleanObject(item))
      .filter((item) => item !== null && item !== undefined && item !== "");
  }

  const cleaned = {};

  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined || value === "") continue;

    if (typeof value === "object") {
      const nested = cleanObject(value);

      if (
        nested &&
        typeof nested === "object" &&
        Object.keys(nested).length > 0
      ) {
        cleaned[key] = nested;
      }
    } else {
      cleaned[key] = value;
    }
  }

  return cleaned;
}

function collectRows(obj, rows = [], pathName = "root") {
  if (!obj || typeof obj !== "object") return rows;

  if (Array.isArray(obj)) {
    obj.forEach((item, index) => {
      collectRows(item, rows, `${pathName}[${index}]`);
    });

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
    text.includes("ups") ||
    text.includes("warehouse") ||
    text.includes("mallwarehouse");

  if (looksUseful && keys.length <= 60) {
    rows.push({
      path: pathName,
      value: obj,
    });
  }

  for (const [key, value] of Object.entries(obj)) {
    if (value && typeof value === "object") {
      collectRows(value, rows, `${pathName}.${key}`);
    }
  }

  return rows;
}

function isSuccess(response) {
  return (
    response?.success === true ||
    response?.errorCode === 1000000 ||
    response?.error_code === 1000000
  );
}

async function main() {
  console.log("Temu carrier lista teszt - mallWarehouseId verzió");
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

  const mallWarehouseId =
    prepareResponse?.result?.availableReturnWarehouseList?.[0]?.warehouseId ||
    null;

  console.log("mallWarehouseId:", mallWarehouseId || "-");
  console.log("----------");

  const baseTopLevel = {
    parentOrderSn: PARENT_ORDER_SN,
    parentAfterSalesSn: PARENT_AFTER_SALES_SN,
    mallWarehouseId,
    countryCode: "HU",
  };

  const baseMinimal = {
    parentAfterSalesSn: PARENT_AFTER_SALES_SN,
    mallWarehouseId,
  };

  const onlyWarehouse = {
    mallWarehouseId,
  };

  const payloadVariants = [
    {
      name: "mallWarehouseId_only",
      payload: {
        mallWarehouseId,
      },
    },
    {
      name: "mallWarehouseId_with_order",
      payload: {
        parentOrderSn: PARENT_ORDER_SN,
        parentAfterSalesSn: PARENT_AFTER_SALES_SN,
        mallWarehouseId,
      },
    },
    {
      name: "mallWarehouseId_country_hu",
      payload: {
        parentOrderSn: PARENT_ORDER_SN,
        parentAfterSalesSn: PARENT_AFTER_SALES_SN,
        mallWarehouseId,
        countryCode: "HU",
      },
    },
    {
      name: "mallWarehouseId_return_country_hu",
      payload: {
        parentOrderSn: PARENT_ORDER_SN,
        parentAfterSalesSn: PARENT_AFTER_SALES_SN,
        mallWarehouseId,
        returnCountryCode: "HU",
      },
    },
    {
      name: "request_mallWarehouseId_base",
      payload: {
        request: baseTopLevel,
      },
    },
    {
      name: "request_mallWarehouseId_minimal",
      payload: {
        request: baseMinimal,
      },
    },
    {
      name: "request_mallWarehouseId_only",
      payload: {
        request: onlyWarehouse,
      },
    },
    {
      name: "carrierGetRequest_mallWarehouseId_base",
      payload: {
        carrierGetRequest: baseTopLevel,
      },
    },
    {
      name: "carrierGetRequest_mallWarehouseId_minimal",
      payload: {
        carrierGetRequest: baseMinimal,
      },
    },
    {
      name: "carrierQueryRequest_mallWarehouseId_base",
      payload: {
        carrierQueryRequest: baseTopLevel,
      },
    },
    {
      name: "carrierQueryRequest_mallWarehouseId_minimal",
      payload: {
        carrierQueryRequest: baseMinimal,
      },
    },
    {
      name: "queryRequest_mallWarehouseId_base",
      payload: {
        queryRequest: baseTopLevel,
      },
    },
    {
      name: "queryRequest_mallWarehouseId_minimal",
      payload: {
        queryRequest: baseMinimal,
      },
    },
    {
      name: "param_mallWarehouseId_base",
      payload: {
        param: baseTopLevel,
      },
    },
    {
      name: "input_mallWarehouseId_base",
      payload: {
        input: baseTopLevel,
      },
    },

    // Extra próbák, ha a Temu nem mallWarehouseId-t, hanem warehouse azonosítót vár más néven
    {
      name: "returnWarehouseId_and_mallWarehouseId",
      payload: {
        parentOrderSn: PARENT_ORDER_SN,
        parentAfterSalesSn: PARENT_AFTER_SALES_SN,
        mallWarehouseId,
        returnWarehouseId: mallWarehouseId,
        countryCode: "HU",
      },
    },
    {
      name: "request_returnWarehouseId_and_mallWarehouseId",
      payload: {
        request: {
          parentOrderSn: PARENT_ORDER_SN,
          parentAfterSalesSn: PARENT_AFTER_SALES_SN,
          mallWarehouseId,
          returnWarehouseId: mallWarehouseId,
          countryCode: "HU",
        },
      },
    },
    {
      name: "warehouseId_and_mallWarehouseId",
      payload: {
        parentOrderSn: PARENT_ORDER_SN,
        parentAfterSalesSn: PARENT_AFTER_SALES_SN,
        mallWarehouseId,
        warehouseId: mallWarehouseId,
        countryCode: "HU",
      },
    },
    {
      name: "request_warehouseId_and_mallWarehouseId",
      payload: {
        request: {
          parentOrderSn: PARENT_ORDER_SN,
          parentAfterSalesSn: PARENT_AFTER_SALES_SN,
          mallWarehouseId,
          warehouseId: mallWarehouseId,
          countryCode: "HU",
        },
      },
    },

    // Ha a carrier.get pickup/label típushoz kötött paramétert vár
    {
      name: "mallWarehouseId_returnLabelType",
      payload: {
        parentOrderSn: PARENT_ORDER_SN,
        parentAfterSalesSn: PARENT_AFTER_SALES_SN,
        mallWarehouseId,
        returnLabelType: 1,
      },
    },
    {
      name: "request_mallWarehouseId_returnLabelType",
      payload: {
        request: {
          parentOrderSn: PARENT_ORDER_SN,
          parentAfterSalesSn: PARENT_AFTER_SALES_SN,
          mallWarehouseId,
          returnLabelType: 1,
        },
      },
    },
    {
      name: "mallWarehouseId_deliveryType",
      payload: {
        parentOrderSn: PARENT_ORDER_SN,
        parentAfterSalesSn: PARENT_AFTER_SALES_SN,
        mallWarehouseId,
        deliveryType: 1,
      },
    },
    {
      name: "request_mallWarehouseId_deliveryType",
      payload: {
        request: {
          parentOrderSn: PARENT_ORDER_SN,
          parentAfterSalesSn: PARENT_AFTER_SALES_SN,
          mallWarehouseId,
          deliveryType: 1,
        },
      },
    },
  ].map((variant) => ({
    name: variant.name,
    payload: cleanObject(variant.payload),
  }));

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
        console.log("Lehetséges carrier / warehouse sorok:");
        console.log(JSON.stringify(rows, null, 2));
      }

      if (isSuccess(response)) {
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

  console.log("Carrier teszt vége.");
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