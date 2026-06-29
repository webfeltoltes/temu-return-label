require("dotenv").config();

const axios = require("axios");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const FormData = require("form-data");

const {
  TEMU_APP_KEY,
  TEMU_APP_SECRET,
  TEMU_ACCESS_TOKEN,
  TEMU_API_URL = "https://openapi-b-eu.temu.com/openapi/router",
} = process.env;

const PARENT_ORDER_SN = "PO-090-12329685781113212";
const PARENT_AFTER_SALES_SN = "PO-090-12329685781113212-D01";

const RETURN_TRACKING_NUMBER = "Z3016356633";
const RETURN_CARRIER_NAME = "Packeta";

const PDF_PATH = path.join(
  __dirname,
  "labels",
  "PO-090-12329685781113212-3016356633-A7_on_A7.pdf"
);

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

function getTemuBaseUrl() {
  const url = new URL(TEMU_API_URL);
  return `${url.protocol}//${url.host}`;
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

async function uploadGeneralFileDirect(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Nem találom a PDF fájlt: ${filePath}`);
  }

  if (!TEMU_APP_KEY || !TEMU_APP_SECRET || !TEMU_ACCESS_TOKEN) {
    throw new Error(
      "Hiányzik TEMU_APP_KEY / TEMU_APP_SECRET / TEMU_ACCESS_TOKEN a .env fájlból."
    );
  }

  const baseUrl = getTemuBaseUrl();

  const uploadAttempts = [
    {
      name: "general_file_file_form_timestamp_ms",
      url: `${baseUrl}/api/galerie/general_file`,
      fileField: "file",
      paramsPlacement: "form",
      timestampMode: "ms",
      includeAccessToken: true,
      includeDataType: false,
    },
    {
      name: "general_file_file_query_timestamp_ms",
      url: `${baseUrl}/api/galerie/general_file`,
      fileField: "file",
      paramsPlacement: "query",
      timestampMode: "ms",
      includeAccessToken: true,
      includeDataType: false,
    },
    {
      name: "general_file_file_form_timestamp_ms_with_data_type",
      url: `${baseUrl}/api/galerie/general_file`,
      fileField: "file",
      paramsPlacement: "form",
      timestampMode: "ms",
      includeAccessToken: true,
      includeDataType: true,
    },
    {
      name: "general_file_file_query_timestamp_ms_with_data_type",
      url: `${baseUrl}/api/galerie/general_file`,
      fileField: "file",
      paramsPlacement: "query",
      timestampMode: "ms",
      includeAccessToken: true,
      includeDataType: true,
    },
    {
      name: "general_file_file_form_timestamp_seconds",
      url: `${baseUrl}/api/galerie/general_file`,
      fileField: "file",
      paramsPlacement: "form",
      timestampMode: "seconds",
      includeAccessToken: true,
      includeDataType: false,
    },
    {
      name: "general_file_file_query_timestamp_seconds",
      url: `${baseUrl}/api/galerie/general_file`,
      fileField: "file",
      paramsPlacement: "query",
      timestampMode: "seconds",
      includeAccessToken: true,
      includeDataType: false,
    },
    {
      name: "general_file_upload_file_form_timestamp_ms",
      url: `${baseUrl}/api/galerie/general_file/upload`,
      fileField: "file",
      paramsPlacement: "form",
      timestampMode: "ms",
      includeAccessToken: true,
      includeDataType: false,
    },
    {
      name: "general_file_upload_file_query_timestamp_ms",
      url: `${baseUrl}/api/galerie/general_file/upload`,
      fileField: "file",
      paramsPlacement: "query",
      timestampMode: "ms",
      includeAccessToken: true,
      includeDataType: false,
    },
  ];

  for (const attempt of uploadAttempts) {
    console.log("File upload próba:", attempt.name);
    console.log("URL:", attempt.url);

    const timestamp =
      attempt.timestampMode === "ms"
        ? Date.now()
        : Math.floor(Date.now() / 1000);

    const params = {
      app_key: TEMU_APP_KEY,
      timestamp,
    };

    if (attempt.includeAccessToken) {
      params.access_token = TEMU_ACCESS_TOKEN;
    }

    if (attempt.includeDataType) {
      params.data_type = "JSON";
    }

    params.sign = makeSign(params, TEMU_APP_SECRET);

    const form = new FormData();

    let requestUrl = attempt.url;

    if (attempt.paramsPlacement === "form") {
      for (const [key, value] of Object.entries(params)) {
        form.append(key, value);
      }
    }

    if (attempt.paramsPlacement === "query") {
      const query = new URLSearchParams(params);
      requestUrl = `${attempt.url}?${query.toString()}`;
    }

    form.append(attempt.fileField, fs.createReadStream(filePath), {
      filename: path.basename(filePath),
      contentType: "application/pdf",
    });

    try {
      const response = await axios.post(requestUrl, form, {
        headers: form.getHeaders(),
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
        timeout: 60000,
      });

      console.log("Upload válasz:");
      console.log(JSON.stringify(response.data, null, 2));

      if (isTemuSuccess(response.data)) {
        console.log("Sikeres file upload próba:", attempt.name);
        return response.data;
      }

      console.log("Nem sikerült ezzel a file upload változattal.");
      console.log("----------");
    } catch (error) {
      console.log("File upload request hiba:", attempt.name);

      if (error.response) {
        console.log("HTTP status:", error.response.status);
        console.log(error.response.data);
      } else {
        console.log(error.message);
      }

      console.log("----------");
    }
  }

  return {
    success: false,
    errorMsg: "Egyik direct file upload változat sem sikerült.",
  };
}

function findValueByKeys(obj, keys) {
  if (!obj || typeof obj !== "object") return null;

  for (const key of keys) {
    if (obj[key]) return obj[key];
  }

  for (const value of Object.values(obj)) {
    if (value && typeof value === "object") {
      const found = findValueByKeys(value, keys);
      if (found) return found;
    }
  }

  return null;
}

function isTemuSuccess(response) {
  if (!response || typeof response !== "object") return false;

  if (response.success === true) return true;
  if (response.result?.success === true) return true;
  if (response.errorCode === 1000000) return true;
  if (response.error_code === 1000000) return true;

  return false;
}

function getTemuErrorMessage(response) {
  if (!response || typeof response !== "object") return "Ismeretlen hiba.";

  return (
    response.errorMsg ||
    response.error_msg ||
    response.message ||
    response.msg ||
    response.result?.errorMsg ||
    response.result?.error_msg ||
    JSON.stringify(response)
  );
}

function buildReturnLabelPayloadVariants(fileValue, returnWarehouseId) {
  return [
    {
      name: "variant_1_returnLabelFileId_trackingNumber_carrierName",
      payload: {
        parentOrderSn: PARENT_ORDER_SN,
        parentAfterSalesSn: PARENT_AFTER_SALES_SN,
        returnLabelFileId: fileValue,
        trackingNumber: RETURN_TRACKING_NUMBER,
        carrierName: RETURN_CARRIER_NAME,
      },
    },
    {
      name: "variant_2_with_returnWarehouseId",
      payload: {
        parentOrderSn: PARENT_ORDER_SN,
        parentAfterSalesSn: PARENT_AFTER_SALES_SN,
        returnWarehouseId,
        returnLabelFileId: fileValue,
        trackingNumber: RETURN_TRACKING_NUMBER,
        carrierName: RETURN_CARRIER_NAME,
      },
    },
    {
      name: "variant_3_fileId_logisticsTrackingNumber_logisticsProviderName",
      payload: {
        parentOrderSn: PARENT_ORDER_SN,
        parentAfterSalesSn: PARENT_AFTER_SALES_SN,
        fileId: fileValue,
        logisticsTrackingNumber: RETURN_TRACKING_NUMBER,
        logisticsProviderName: RETURN_CARRIER_NAME,
      },
    },
    {
      name: "variant_4_returnLabelUrl_trackingNumber_carrierName",
      payload: {
        parentOrderSn: PARENT_ORDER_SN,
        parentAfterSalesSn: PARENT_AFTER_SALES_SN,
        returnLabelUrl: fileValue,
        trackingNumber: RETURN_TRACKING_NUMBER,
        carrierName: RETURN_CARRIER_NAME,
      },
    },
    {
      name: "variant_5_returnLabelFileId_returnTrackingNumber_returnCarrierName",
      payload: {
        parentOrderSn: PARENT_ORDER_SN,
        parentAfterSalesSn: PARENT_AFTER_SALES_SN,
        returnLabelFileId: fileValue,
        returnTrackingNumber: RETURN_TRACKING_NUMBER,
        returnCarrierName: RETURN_CARRIER_NAME,
      },
    },
    {
      name: "variant_6_returnLabelFileList",
      payload: {
        parentOrderSn: PARENT_ORDER_SN,
        parentAfterSalesSn: PARENT_AFTER_SALES_SN,
        returnTrackingNumber: RETURN_TRACKING_NUMBER,
        carrierName: RETURN_CARRIER_NAME,
        returnLabelFileList: [
          {
            fileId: fileValue,
          },
        ],
      },
    },
    {
      name: "variant_7_returnLabelInfo",
      payload: {
        parentOrderSn: PARENT_ORDER_SN,
        parentAfterSalesSn: PARENT_AFTER_SALES_SN,
        returnLabelInfo: {
          fileId: fileValue,
          trackingNumber: RETURN_TRACKING_NUMBER,
          carrierName: RETURN_CARRIER_NAME,
        },
      },
    },
    {
      name: "variant_8_logisticsInfo",
      payload: {
        parentOrderSn: PARENT_ORDER_SN,
        parentAfterSalesSn: PARENT_AFTER_SALES_SN,
        returnLabelFileId: fileValue,
        logisticsInfo: {
          trackingNumber: RETURN_TRACKING_NUMBER,
          carrierName: RETURN_CARRIER_NAME,
        },
      },
    },
    {
      name: "variant_9_returnLogisticsInfo_with_warehouse",
      payload: {
        parentOrderSn: PARENT_ORDER_SN,
        parentAfterSalesSn: PARENT_AFTER_SALES_SN,
        returnWarehouseId,
        returnLogisticsInfo: {
          returnLabelFileId: fileValue,
          trackingNumber: RETURN_TRACKING_NUMBER,
          carrierName: RETURN_CARRIER_NAME,
        },
      },
    },
  ].map((variant) => {
    if (!variant.payload.returnWarehouseId) {
      delete variant.payload.returnWarehouseId;
    }

    return variant;
  });
}

async function main() {
  console.log("PDF ellenőrzés:");
  console.log(PDF_PATH);

  if (!fs.existsSync(PDF_PATH)) {
    throw new Error("A PDF fájl nem létezik ezen az útvonalon.");
  }

  console.log("Temu adatok:");
  console.log("parentOrderSn:", PARENT_ORDER_SN);
  console.log("parentAfterSalesSn:", PARENT_AFTER_SALES_SN);
  console.log("trackingNumber:", RETURN_TRACKING_NUMBER);
  console.log("carrier:", RETURN_CARRIER_NAME);
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

  console.log("2. PDF feltöltés Temuba direct general_file végponton...");

  const fileUploadResponse = await uploadGeneralFileDirect(PDF_PATH);

  console.log("Végső file upload válasz:");
  console.log(JSON.stringify(fileUploadResponse, null, 2));
  console.log("----------");

  const fileValue =
    findValueByKeys(fileUploadResponse, [
      "fileId",
      "file_id",
      "fileKey",
      "file_key",
      "fileUrl",
      "file_url",
      "url",
      "uri",
      "id",
    ]) || null;

  if (!fileValue) {
    console.log("Nem találtam file azonosítót / URL-t a Temu upload válaszban.");
    console.log(
      "Ha minden upload próba hibás, akkor a Temu file upload endpoint pontos URL-je / jogosultsága hiányzik."
    );
    return;
  }

  console.log("Talált Temu file érték:");
  console.log(fileValue);
  console.log("----------");

  console.log("3. Return label feltöltési payload-változatok próbája...");

  const variants = buildReturnLabelPayloadVariants(fileValue, returnWarehouseId);

  for (const variant of variants) {
    console.log("Próba:", variant.name);
    console.log("Payload:");
    console.log(JSON.stringify(variant.payload, null, 2));

    try {
      const response = await callTemu(
        "temu.aftersales.upload.returnlabel",
        variant.payload
      );

      console.log("Temu válasz:");
      console.log(JSON.stringify(response, null, 2));

      if (isTemuSuccess(response)) {
        console.log("SIKERES TEMU RETURN LABEL FELTÖLTÉS.");
        console.log("Sikeres variant:", variant.name);
        console.log("Tracking:", RETURN_TRACKING_NUMBER);
        console.log("Carrier:", RETURN_CARRIER_NAME);
        return;
      }

      console.log("Nem sikerült ezzel a változattal.");
      console.log("Hiba:", getTemuErrorMessage(response));
      console.log("----------");
    } catch (error) {
      console.log("HTTP / request hiba ennél a változatnál:", variant.name);

      if (error.response) {
        console.log("HTTP status:", error.response.status);
        console.log(error.response.data);
      } else {
        console.log(error.message);
      }

      console.log("----------");
    }
  }

  console.log("Egyik payload-változattal sem sikerült.");
  console.log("A Temu válasz alapján pontosítjuk a mezőneveket.");
}

main().catch((error) => {
  console.error("Temu PDF feltöltés teszt hiba:");

  if (error.response) {
    console.error("HTTP status:", error.response.status);
    console.error(error.response.data);
    return;
  }

  console.error(error.message);
});