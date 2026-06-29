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

function buildUploadReturnLabelPayloadVariants({
  returnWarehouseId,
  signature,
  pdfBase64,
}) {
  const fileName = path.basename(PDF_PATH);

  return [
    {
      name: "variant_1_signature_fileContent_tracking_carrier",
      payload: {
        parentOrderSn: PARENT_ORDER_SN,
        parentAfterSalesSn: PARENT_AFTER_SALES_SN,
        returnWarehouseId,
        signature,
        trackingNumber: RETURN_TRACKING_NUMBER,
        carrierName: RETURN_CARRIER_NAME,
        fileName,
        fileType: "pdf",
        fileContent: pdfBase64,
      },
    },
    {
      name: "variant_2_signature_returnLabelFile_object",
      payload: {
        parentOrderSn: PARENT_ORDER_SN,
        parentAfterSalesSn: PARENT_AFTER_SALES_SN,
        returnWarehouseId,
        signature,
        trackingNumber: RETURN_TRACKING_NUMBER,
        carrierName: RETURN_CARRIER_NAME,
        returnLabelFile: {
          fileName,
          fileType: "pdf",
          fileContent: pdfBase64,
        },
      },
    },
    {
      name: "variant_3_uploadSignature_returnLabelFile_object",
      payload: {
        parentOrderSn: PARENT_ORDER_SN,
        parentAfterSalesSn: PARENT_AFTER_SALES_SN,
        returnWarehouseId,
        uploadSignature: signature,
        trackingNumber: RETURN_TRACKING_NUMBER,
        carrierName: RETURN_CARRIER_NAME,
        returnLabelFile: {
          fileName,
          fileType: "pdf",
          fileContent: pdfBase64,
        },
      },
    },
    {
      name: "variant_4_returnLabelSignature_returnLabelFile_object",
      payload: {
        parentOrderSn: PARENT_ORDER_SN,
        parentAfterSalesSn: PARENT_AFTER_SALES_SN,
        returnWarehouseId,
        returnLabelSignature: signature,
        trackingNumber: RETURN_TRACKING_NUMBER,
        carrierName: RETURN_CARRIER_NAME,
        returnLabelFile: {
          fileName,
          fileType: "pdf",
          fileContent: pdfBase64,
        },
      },
    },
    {
      name: "variant_5_signature_labelFile_tracking_carrier",
      payload: {
        parentOrderSn: PARENT_ORDER_SN,
        parentAfterSalesSn: PARENT_AFTER_SALES_SN,
        returnWarehouseId,
        signature,
        trackingNumber: RETURN_TRACKING_NUMBER,
        carrierName: RETURN_CARRIER_NAME,
        labelFile: {
          fileName,
          fileType: "pdf",
          fileContent: pdfBase64,
        },
      },
    },
    {
      name: "variant_6_signature_returnLogisticsInfo",
      payload: {
        parentOrderSn: PARENT_ORDER_SN,
        parentAfterSalesSn: PARENT_AFTER_SALES_SN,
        returnWarehouseId,
        signature,
        returnLogisticsInfo: {
          trackingNumber: RETURN_TRACKING_NUMBER,
          carrierName: RETURN_CARRIER_NAME,
          returnLabelFile: {
            fileName,
            fileType: "pdf",
            fileContent: pdfBase64,
          },
        },
      },
    },
    {
      name: "variant_7_signature_returnLabelInfo",
      payload: {
        parentOrderSn: PARENT_ORDER_SN,
        parentAfterSalesSn: PARENT_AFTER_SALES_SN,
        returnWarehouseId,
        signature,
        returnLabelInfo: {
          trackingNumber: RETURN_TRACKING_NUMBER,
          carrierName: RETURN_CARRIER_NAME,
          fileName,
          fileType: "pdf",
          fileContent: pdfBase64,
        },
      },
    },
    {
      name: "variant_8_signature_logisticsTrackingNumber_providerName",
      payload: {
        parentOrderSn: PARENT_ORDER_SN,
        parentAfterSalesSn: PARENT_AFTER_SALES_SN,
        returnWarehouseId,
        signature,
        logisticsTrackingNumber: RETURN_TRACKING_NUMBER,
        logisticsProviderName: RETURN_CARRIER_NAME,
        returnLabelFile: {
          fileName,
          fileType: "pdf",
          fileContent: pdfBase64,
        },
      },
    },
    {
      name: "variant_9_signature_trackingNo_logisticsCompany",
      payload: {
        parentOrderSn: PARENT_ORDER_SN,
        parentAfterSalesSn: PARENT_AFTER_SALES_SN,
        returnWarehouseId,
        signature,
        trackingNo: RETURN_TRACKING_NUMBER,
        logisticsCompany: RETURN_CARRIER_NAME,
        returnLabelFile: {
          fileName,
          fileType: "pdf",
          fileContent: pdfBase64,
        },
      },
    },
    {
      name: "variant_10_signature_waybillNo_carrier",
      payload: {
        parentOrderSn: PARENT_ORDER_SN,
        parentAfterSalesSn: PARENT_AFTER_SALES_SN,
        returnWarehouseId,
        signature,
        waybillNo: RETURN_TRACKING_NUMBER,
        carrier: RETURN_CARRIER_NAME,
        returnLabelFile: {
          fileName,
          fileType: "pdf",
          fileContent: pdfBase64,
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

async function tryUploadReturnLabel({ returnWarehouseId, signature, pdfBase64 }) {
  const variants = buildUploadReturnLabelPayloadVariants({
    returnWarehouseId,
    signature,
    pdfBase64,
  });

  for (const variant of variants) {
    console.log("Próba:", variant.name);
    console.log("Payload preview:");
    console.log(
      JSON.stringify(
        {
          ...variant.payload,
          fileContent: variant.payload.fileContent
            ? `[base64 hossz: ${variant.payload.fileContent.length}]`
            : undefined,
          returnLabelFile: variant.payload.returnLabelFile
            ? {
                ...variant.payload.returnLabelFile,
                fileContent: `[base64 hossz: ${variant.payload.returnLabelFile.fileContent.length}]`,
              }
            : undefined,
          labelFile: variant.payload.labelFile
            ? {
                ...variant.payload.labelFile,
                fileContent: `[base64 hossz: ${variant.payload.labelFile.fileContent.length}]`,
              }
            : undefined,
          returnLogisticsInfo: variant.payload.returnLogisticsInfo
            ? {
                ...variant.payload.returnLogisticsInfo,
                returnLabelFile: variant.payload.returnLogisticsInfo.returnLabelFile
                  ? {
                      ...variant.payload.returnLogisticsInfo.returnLabelFile,
                      fileContent: `[base64 hossz: ${variant.payload.returnLogisticsInfo.returnLabelFile.fileContent.length}]`,
                    }
                  : undefined,
              }
            : undefined,
          returnLabelInfo: variant.payload.returnLabelInfo
            ? {
                ...variant.payload.returnLabelInfo,
                fileContent: variant.payload.returnLabelInfo.fileContent
                  ? `[base64 hossz: ${variant.payload.returnLabelInfo.fileContent.length}]`
                  : undefined,
              }
            : undefined,
        },
        null,
        2
      )
    );

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

  const signatureResponse = await callTemu("temu.aftersales.signature.get", {});

  console.log("Signature válasz:");
  console.log(JSON.stringify(signatureResponse, null, 2));
  console.log("----------");

  const signature =
    findValueByKeys(signatureResponse, [
      "signature",
      "uploadSignature",
      "returnLabelSignature",
    ]) || null;

  if (!signature) {
    console.log("Nem találtam signature mezőt.");
    return;
  }

  console.log("Talált signature:");
  console.log(signature);
  console.log("----------");

  console.log("3. Return label feltöltés próbája Temuba...");

  const ok = await tryUploadReturnLabel({
    returnWarehouseId,
    signature,
    pdfBase64,
  });

  if (!ok) {
    console.log("Egyik feltöltési változat sem sikerült.");
    console.log("Valószínűleg még a carrier mező pontos neve / carrier ID kell.");
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