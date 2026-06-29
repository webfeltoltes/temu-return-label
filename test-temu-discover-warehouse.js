require("dotenv").config();

const axios = require("axios");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const {
  TEMU_APP_KEY,
  TEMU_APP_SECRET,
  TEMU_ACCESS_TOKEN,
  TEMU_API_URL = "https://openapi-b-eu.temu.com/openapi/router",
} = process.env;

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
    validateStatus: () => true,
  });

  return {
    httpStatus: response.status,
    data: response.data,
  };
}

function isInterestingResponse(data) {
  if (!data || typeof data !== "object") return false;

  const text = JSON.stringify(data).toLowerCase();

  return (
    data.success === true ||
    data.errorCode === 1000000 ||
    text.includes("adria") ||
    text.includes("warehouse") ||
    text.includes("region") ||
    text.includes("returnwarehouse") ||
    text.includes("wh-08329965322380321") ||
    text.includes("carrierdtolist")
  );
}

function findInterestingFields(obj, result = [], pathName = "root") {
  if (!obj || typeof obj !== "object") return result;

  if (Array.isArray(obj)) {
    obj.forEach((item, index) => {
      findInterestingFields(item, result, `${pathName}[${index}]`);
    });

    return result;
  }

  for (const [key, value] of Object.entries(obj)) {
    const lowerKey = key.toLowerCase();
    const valueText =
      value === null || value === undefined
        ? ""
        : typeof value === "object"
          ? JSON.stringify(value).toLowerCase()
          : String(value).toLowerCase();

    const interesting =
      lowerKey.includes("warehouse") ||
      lowerKey.includes("region") ||
      lowerKey.includes("address") ||
      lowerKey.includes("return") ||
      lowerKey.includes("carrier") ||
      valueText.includes("adria") ||
      valueText.includes("wh-08329965322380321");

    if (interesting) {
      result.push({
        path: `${pathName}.${key}`,
        key,
        value,
      });
    }

    if (value && typeof value === "object") {
      findInterestingFields(value, result, `${pathName}.${key}`);
    }
  }

  return result;
}

async function main() {
  const debugDir = path.join(__dirname, "debug");
  fs.mkdirSync(debugDir, { recursive: true });

  const apiTypes = [
    // aftersales / return warehouse tippek
    "temu.aftersales.returnwarehouse.get",
    "temu.aftersales.returnwarehouse.list.get",
    "temu.aftersales.returnwarehouse.query",
    "temu.aftersales.returnwarehouse.query.get",
    "temu.aftersales.return.warehouse.get",
    "temu.aftersales.return.warehouse.list.get",
    "temu.aftersales.warehouse.get",
    "temu.aftersales.warehouse.list.get",

    // merchant warehouse tippek
    "temu.warehouse.get",
    "temu.warehouse.list.get",
    "temu.mall.warehouse.get",
    "temu.mall.warehouse.list.get",
    "bg.warehouse.get",
    "bg.warehouse.list.get",
    "bg.mall.warehouse.get",
    "bg.mall.warehouse.list.get",
    "bg.logistics.warehouse.get",
    "bg.logistics.warehouse.list.get",

    // address / region tippek
    "temu.aftersales.returnaddress.get",
    "temu.aftersales.returnaddress.list.get",
    "temu.aftersales.return.address.get",
    "temu.aftersales.return.address.list.get",
    "temu.region.get",
    "temu.region.list.get",
    "bg.region.get",
    "bg.region.list.get",
    "bg.logistics.region.get",
    "bg.logistics.region.list.get",

    // carrier közvetlen próba kontrollként
    "temu.aftersales.carrier.get",
  ];

  const payloads = [
    {
      name: "empty",
      payload: {},
    },
    {
      name: "page",
      payload: {
        pageNo: 1,
        pageSize: 100,
      },
    },
    {
      name: "query_hu",
      payload: {
        countryCode: "HU",
        pageNo: 1,
        pageSize: 100,
      },
    },
    {
      name: "region_hu",
      payload: {
        regionCode: "HU",
        pageNo: 1,
        pageSize: 100,
      },
    },
    {
      name: "warehouse_id",
      payload: {
        warehouseId: "WH-08329965322380321",
      },
    },
    {
      name: "mall_warehouse_id",
      payload: {
        mallWarehouseId: "WH-08329965322380321",
      },
    },
  ];

  console.log("Temu warehouse / region API discovery indul...");
  console.log("API típusok:", apiTypes.length);
  console.log("Payload próbák:", payloads.length);
  console.log("----------");

  const interestingResults = [];

  for (const type of apiTypes) {
    for (const payloadItem of payloads) {
      console.log(`Próba: ${type} / ${payloadItem.name}`);

      const response = await callTemu(type, payloadItem.payload);

      const row = {
        type,
        payloadName: payloadItem.name,
        payload: payloadItem.payload,
        httpStatus: response.httpStatus,
        data: response.data,
      };

      const interesting = isInterestingResponse(response.data);

      if (interesting) {
        console.log("ÉRDEKES VÁLASZ:");
        console.log(JSON.stringify(response.data, null, 2));

        const fields = findInterestingFields(response.data);

        if (fields.length > 0) {
          console.log("Érdekes mezők:");
          console.log(JSON.stringify(fields, null, 2));
        }

        interestingResults.push({
          ...row,
          fields,
        });
      } else {
        console.log(
          JSON.stringify(
            {
              httpStatus: response.httpStatus,
              success: response.data?.success,
              errorCode: response.data?.errorCode,
              errorMsg: response.data?.errorMsg,
            },
            null,
            2
          )
        );
      }

      console.log("----------");
    }
  }

  const outputPath = path.join(
    debugDir,
    "temu-warehouse-region-discovery.json"
  );

  fs.writeFileSync(outputPath, JSON.stringify(interestingResults, null, 2));

  console.log("Discovery vége.");
  console.log("Érdekes találatok száma:", interestingResults.length);
  console.log("Mentve ide:");
  console.log(outputPath);
}

main().catch((error) => {
  console.error("Discovery hiba:");

  if (error.response) {
    console.error("HTTP status:", error.response.status);
    console.error(error.response.data);
    return;
  }

  console.error(error.message);
});