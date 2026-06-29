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

const TARGET_PARENT_ORDER_SN = "PO-090-09064720359030147";

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

function objectContainsText(obj, text) {
  if (!obj || !text) return false;
  return JSON.stringify(obj).toLowerCase().includes(text.toLowerCase());
}

function findValueByKeys(obj, keys) {
  if (!obj || typeof obj !== "object") return null;

  for (const key of keys) {
    if (obj[key] !== undefined && obj[key] !== null && obj[key] !== "") {
      return obj[key];
    }
  }

  for (const value of Object.values(obj)) {
    if (value && typeof value === "object") {
      const found = findValueByKeys(value, keys);
      if (found !== null && found !== undefined && found !== "") {
        return found;
      }
    }
  }

  return null;
}

function collectUsefulRows(obj, rows = [], pathName = "root") {
  if (!obj || typeof obj !== "object") return rows;

  if (Array.isArray(obj)) {
    obj.forEach((item, index) => {
      collectUsefulRows(item, rows, `${pathName}[${index}]`);
    });

    return rows;
  }

  const text = JSON.stringify(obj).toLowerCase();

  const useful =
    text.includes("packeta") ||
    text.includes("zasilkovna") ||
    text.includes("zásilkovna") ||
    text.includes("carrier") ||
    text.includes("tracking") ||
    text.includes("label") ||
    text.includes("warehouse") ||
    text.includes("returnlabel") ||
    text.includes("return_label") ||
    text.includes("mallwarehouse") ||
    text.includes("logistics");

  if (useful) {
    rows.push({
      path: pathName,
      value: obj,
    });
  }

  for (const [key, value] of Object.entries(obj)) {
    if (value && typeof value === "object") {
      collectUsefulRows(value, rows, `${pathName}.${key}`);
    }
  }

  return rows;
}

async function findAfterSalesByParentOrderSn(parentOrderSn) {
  const now = Math.floor(Date.now() / 1000);
  const daysBack = 365;
  const updateAtStart = now - daysBack * 24 * 60 * 60;
  const updateAtEnd = now;

  const pageSize = 100;
  const maxPages = 30;

  const attempts = [];

  for (let pageNo = 1; pageNo <= maxPages; pageNo++) {
    const payload = {
      pageNo,
      pageSize,
      updateAtStart,
      updateAtEnd,
    };

    console.log("Aftersales list próba:", payload);

    const response = await callTemu(
      "bg.aftersales.parentaftersales.list.get",
      payload
    );

    attempts.push({
      pageNo,
      response,
    });

    console.log("Lista válasz röviden:");
    console.log(
      JSON.stringify(
        {
          success: response?.success,
          errorCode: response?.errorCode,
          errorMsg: response?.errorMsg,
          requestId: response?.requestId,
        },
        null,
        2
      )
    );

    const json = JSON.stringify(response);

    if (!objectContainsText(response, parentOrderSn)) {
      console.log("Ezen az oldalon nincs találat.");
    } else {
      console.log("Találat van ezen az oldalon.");

      const list =
        response?.result?.parentAfterSalesList ||
        response?.result?.list ||
        response?.result?.data ||
        response?.result?.records ||
        [];

      const flatList = Array.isArray(list) ? list : [];

      const directMatch = flatList.find((item) =>
        objectContainsText(item, parentOrderSn)
      );

      if (directMatch) {
        return {
          found: true,
          source: "list_direct_match",
          item: directMatch,
          attempts,
        };
      }

      return {
        found: true,
        source: "raw_response_contains_order",
        item: response,
        attempts,
      };
    }

    const list =
      response?.result?.parentAfterSalesList ||
      response?.result?.list ||
      response?.result?.data ||
      response?.result?.records ||
      [];

    if (Array.isArray(list) && list.length < pageSize) {
      break;
    }
  }

  return {
    found: false,
    attempts,
  };
}

async function getAfterSalesDetail(parentOrderSn, parentAfterSalesSn) {
  console.log("Aftersales detail lekérés:");
  console.log("parentOrderSn:", parentOrderSn);
  console.log("parentAfterSalesSn:", parentAfterSalesSn);

  return await callTemu("temu.aftersales.parentaftersales.detail.get", {
    parentOrderSn,
    parentAfterSalesSn,
  });
}

async function main() {
  console.log("Meglévő Temu return label vizsgálat");
  console.log("parentOrderSn:", TARGET_PARENT_ORDER_SN);
  console.log("----------");

  const found = await findAfterSalesByParentOrderSn(TARGET_PARENT_ORDER_SN);

  const outputDir = path.join(__dirname, "debug");
  fs.mkdirSync(outputDir, { recursive: true });

  const listDebugPath = path.join(
    outputDir,
    `${TARGET_PARENT_ORDER_SN}-aftersales-list-debug.json`
  );

  fs.writeFileSync(listDebugPath, JSON.stringify(found, null, 2));

  console.log("Lista debug mentve:");
  console.log(listDebugPath);
  console.log("----------");

  let parentAfterSalesSn =
    findValueByKeys(found, [
      "parentAfterSalesSn",
      "parent_after_sales_sn",
      "afterSalesSn",
      "after_sales_sn",
    ]) || null;

  if (!parentAfterSalesSn) {
    parentAfterSalesSn = `${TARGET_PARENT_ORDER_SN}-D01`;
    console.log("Nem találtam parentAfterSalesSn-t, D01-et próbálok:");
    console.log(parentAfterSalesSn);
  } else {
    console.log("Talált parentAfterSalesSn:");
    console.log(parentAfterSalesSn);
  }

  console.log("----------");

  const detailResponse = await getAfterSalesDetail(
    TARGET_PARENT_ORDER_SN,
    parentAfterSalesSn
  );

  const detailDebugPath = path.join(
    outputDir,
    `${TARGET_PARENT_ORDER_SN}-aftersales-detail-debug.json`
  );

  fs.writeFileSync(detailDebugPath, JSON.stringify(detailResponse, null, 2));

  console.log("Detail válasz:");
  console.log(JSON.stringify(detailResponse, null, 2));

  console.log("Detail debug mentve:");
  console.log(detailDebugPath);
  console.log("----------");

  const usefulRows = collectUsefulRows(detailResponse);

  console.log("Hasznos / label / carrier / tracking sorok:");
  console.log(JSON.stringify(usefulRows, null, 2));
  console.log("----------");

  const extracted = {
    parentOrderSn: TARGET_PARENT_ORDER_SN,
    parentAfterSalesSn,
    carrierId: findValueByKeys(detailResponse, [
      "carrierId",
      "carrier_id",
      "logisticsCarrierId",
      "logistics_carrier_id",
    ]),
    carrierName: findValueByKeys(detailResponse, [
      "carrierName",
      "carrier_name",
      "logisticsCompany",
      "logisticsProviderName",
      "logistics_provider_name",
      "shippingCarrierName",
    ]),
    trackingNumber: findValueByKeys(detailResponse, [
      "trackingNumber",
      "tracking_number",
      "trackingNo",
      "waybillNo",
      "waybill_no",
      "logisticsTrackingNumber",
    ]),
    returnLabelUrl: findValueByKeys(detailResponse, [
      "returnLabelUrl",
      "return_label_url",
      "labelUrl",
      "label_url",
      "pickUpCertificateImageUrl",
    ]),
    mallWarehouseId: findValueByKeys(detailResponse, [
      "mallWarehouseId",
      "mall_warehouse_id",
      "returnWarehouseId",
      "warehouseId",
    ]),
  };

  console.log("Kinyert adatok:");
  console.log(JSON.stringify(extracted, null, 2));
}

main().catch((error) => {
  console.error("Meglévő return label vizsgálat hiba:");

  if (error.response) {
    console.error("HTTP status:", error.response.status);
    console.error(error.response.data);
    return;
  }

  console.error(error.message);
});