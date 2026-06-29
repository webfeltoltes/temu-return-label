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

function findObjectWithKeys(obj, requiredKeys) {
  if (!obj || typeof obj !== "object") return null;

  const hasAll = requiredKeys.every((key) => obj[key] !== undefined);

  if (hasAll) {
    return obj;
  }

  for (const value of Object.values(obj)) {
    if (value && typeof value === "object") {
      const found = findObjectWithKeys(value, requiredKeys);
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

async function uploadUsingSignatureResponse(signatureResponse, filePath) {
  const result = signatureResponse?.result || signatureResponse;

  const uploadUrl =
    findValueByKeys(result, [
      "uploadUrl",
      "upload_url",
      "url",
      "fileUploadUrl",
      "file_upload_url",
      "host",
      "endpoint",
    ]) || null;

  if (!uploadUrl) {
    console.log("A signature.get válaszban nem találtam upload URL-t.");
    return null;
  }

  console.log("Talált upload URL:");
  console.log(uploadUrl);

  const fileFieldName =
    findValueByKeys(result, [
      "fileFieldName",
      "file_field_name",
      "fileNameField",
      "file_name_field",
    ]) || "file";

  const knownFieldNames = [
    "key",
    "policy",
    "OSSAccessKeyId",
    "accessid",
    "accessId",
    "signature",
    "success_action_status",
    "callback",
    "x-oss-security-token",
    "securityToken",
    "token",
    "dir",
    "fileName",
    "file_name",
  ];

  const form = new FormData();

  for (const key of knownFieldNames) {
    const value = findValueByKeys(result, [key]);

    if (value !== null && value !== undefined) {
      form.append(key, value);
    }
  }

  form.append(fileFieldName, fs.createReadStream(filePath), {
    filename: path.basename(filePath),
    contentType: "application/pdf",
  });

  console.log("Signature alapú PDF upload próba...");
  console.log("file field:", fileFieldName);

  try {
    const response = await axios.post(uploadUrl, form, {
      headers: form.getHeaders(),
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
      timeout: 60000,
    });

    console.log("Signature upload válasz:");
    console.log(JSON.stringify(response.data, null, 2));

    return response.data;
  } catch (error) {
    console.log("Signature upload hiba:");

    if (error.response) {
      console.log("HTTP status:", error.response.status);
      console.log(error.response.data);
    } else {
      console.log(error.message);
    }

    return null;
  }
}

function buildUploadReturnLabelPayloadVariants(fileValue, returnWarehouseId, pdfBase64) {
  return [
    {
      name: "variant_1_fileId_tracking_carrier_warehouse",
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
      name: "variant_2_fileUrl_tracking_carrier_warehouse",
      payload: {
        parentOrderSn: PARENT_ORDER_SN,
        parentAfterSalesSn: PARENT_AFTER_SALES_SN,
        returnWarehouseId,
        returnLabelUrl: fileValue,
        trackingNumber: RETURN_TRACKING_NUMBER,
        carrierName: RETURN_CARRIER_NAME,
      },
    },
    {
      name: "variant_3_fileId_logistics_names",
      payload: {
        parentOrderSn: PARENT_ORDER_SN,
        parentAfterSalesSn: PARENT_AFTER_SALES_SN,
        returnWarehouseId,
        fileId: fileValue,
        logisticsTrackingNumber: RETURN_TRACKING_NUMBER,
        logisticsProviderName: RETURN_CARRIER_NAME,
      },
    },
    {
      name: "variant_4_returnLabelInfo_fileId",
      payload: {
        parentOrderSn: PARENT_ORDER_SN,
        parentAfterSalesSn: PARENT_AFTER_SALES_SN,
        returnWarehouseId,
        returnLabelInfo: {
          fileId: fileValue,
          trackingNumber: RETURN_TRACKING_NUMBER,
          carrierName: RETURN_CARRIER_NAME,
        },
      },
    },
    {
      name: "variant_5_returnLogisticsInfo",
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
    {
      name: "variant_6_base64_direct_returnLabelFile",
      payload: {
        parentOrderSn: PARENT_ORDER_SN,
        parentAfterSalesSn: PARENT_AFTER_SALES_SN,
        returnWarehouseId,
        trackingNumber: RETURN_TRACKING_NUMBER,
        carrierName: RETURN_CARRIER_NAME,
        returnLabelFile: {
          fileName: path.basename(PDF_PATH),
          fileType: "pdf",
          fileContent: pdfBase64,
        },
      },
    },
    {
      name: "variant_7_base64_direct_fileContent",
      payload: {
        parentOrderSn: PARENT_ORDER_SN,
        parentAfterSalesSn: PARENT_AFTER_SALES_SN,
        returnWarehouseId,
        trackingNumber: RETURN_TRACKING_NUMBER,
        carrierName: RETURN_CARRIER_NAME,
        fileName: path.basename(PDF_PATH),
        fileType: "pdf",
        fileContent: pdfBase64,
      },
    },
    {
      name: "variant_8_tracking_only_no_pdf",
      payload: {
        parentOrderSn: PARENT_ORDER_SN,
        parentAfterSalesSn: PARENT_AFTER_SALES_SN,
        returnWarehouseId,
        trackingNumber: RETURN_TRACKING_NUMBER,
        carrierName: RETURN_CARRIER_NAME,
      },
    },
  ].map((variant) => {
    if (!variant.payload.returnWarehouseId) {
      delete variant.payload.returnWarehouseId;
    }

    if (!fileValue) {
      delete variant.payload.returnLabelFileId;
      delete variant.payload.returnLabelUrl;
      delete variant.payload.fileId;

      if (variant.payload.returnLabelInfo) {
        delete variant.payload.returnLabelInfo.fileId;
      }

      if (variant.payload.returnLogisticsInfo) {
        delete variant.payload.returnLogisticsInfo.returnLabelFileId;
      }
    }

    return variant;
  });
}

async function tryUploadReturnLabel(fileValue, returnWarehouseId, pdfBase64) {
  const variants = buildUploadReturnLabelPayloadVariants(
    fileValue,
    returnWarehouseId,
    pdfBase64
  );

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
        return true;
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

  return false;
}

async function main() {
  console.log("PDF ellenőrzés:");
  console.log(PDF_PATH);

  if (!fs.existsSync(PDF_PATH)) {
    throw new Error("A PDF fájl nem létezik ezen az útvonalon.");
  }

  const pdfBase64 = fs.readFileSync(PDF_PATH).toString("base64");

  console.log("Temu adatok:");
  console.log("parentOrderSn:", PARENT_ORDER_SN);
  console.log("parentAfterSalesSn:", PARENT_AFTER_SALES_SN);
  console.log("trackingNumber:", RETURN_TRACKING_NUMBER);
  console.log("carrier:", RETURN_CARRIER_NAME);
  console.log("PDF base64 hossz:", pdfBase64.length);
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

  console.log("2. Temu aftersales signature lekérés...");

  const signaturePayloadVariants = [
    {
      name: "signature_empty",
      payload: {},
    },
    {
      name: "signature_with_order",
      payload: {
        parentOrderSn: PARENT_ORDER_SN,
        parentAfterSalesSn: PARENT_AFTER_SALES_SN,
      },
    },
    {
      name: "signature_with_file_info",
      payload: {
        parentOrderSn: PARENT_ORDER_SN,
        parentAfterSalesSn: PARENT_AFTER_SALES_SN,
        fileName: path.basename(PDF_PATH),
        fileType: "pdf",
      },
    },
  ];

  let signatureResponse = null;

  for (const variant of signaturePayloadVariants) {
    console.log("Signature próba:", variant.name);
    console.log("Payload:");
    console.log(JSON.stringify(variant.payload, null, 2));

    const response = await callTemu(
      "temu.aftersales.signature.get",
      variant.payload
    );

    console.log("Signature válasz:");
    console.log(JSON.stringify(response, null, 2));
    console.log("----------");

    if (isTemuSuccess(response)) {
      signatureResponse = response;
      break;
    }
  }

  let fileValue = null;

  if (signatureResponse) {
    console.log("3. Signature alapú PDF upload próba...");

    const signatureUploadResponse = await uploadUsingSignatureResponse(
      signatureResponse,
      PDF_PATH
    );

    console.log("Signature upload végső válasz:");
    console.log(JSON.stringify(signatureUploadResponse, null, 2));
    console.log("----------");

    fileValue =
      findValueByKeys(signatureUploadResponse, [
        "fileId",
        "file_id",
        "fileKey",
        "file_key",
        "fileUrl",
        "file_url",
        "url",
        "uri",
        "id",
        "objectKey",
        "object_key",
      ]) || null;

    if (!fileValue) {
      fileValue =
        findValueByKeys(signatureResponse, [
          "fileId",
          "file_id",
          "fileKey",
          "file_key",
          "fileUrl",
          "file_url",
          "url",
          "uri",
          "id",
          "objectKey",
          "object_key",
        ]) || null;
    }

    console.log("Talált file érték:", fileValue || "-");
    console.log("----------");
  } else {
    console.log("Nem sikerült signature.get választ lekérni.");
    console.log("----------");
  }

  console.log("4. Return label feltöltés próbája Temuba...");

  const ok = await tryUploadReturnLabel(
    fileValue,
    returnWarehouseId,
    pdfBase64
  );

  if (!ok) {
    console.log("Egyik feltöltési változat sem sikerült.");
    console.log("A kimenetből a temu.aftersales.signature.get és upload.returnlabel válasz a döntő.");
  }
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