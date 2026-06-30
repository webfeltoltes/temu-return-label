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
  RETURN_LABEL_PUBLIC_BASE_URL,
  TEMU_PACKETA_CARRIER_ID,
} = process.env;

const PARENT_ORDER_SN = "PO-090-12329685781113212";
const PARENT_AFTER_SALES_SN = "PO-090-12329685781113212-D01";

const TRACKING_NUMBER = "Z3016356633";

const PDF_FILE_NAME =
  "PO-090-12329685781113212-3016356633-A7_on_A7.pdf";

const PDF_PATH = path.join(__dirname, "labels", PDF_FILE_NAME);

function signValue(value) {
  if (value === undefined || value === null || value === "") {
    return "";
  }

  if (typeof value === "object") {
    return JSON.stringify(value);
  }

  return String(value);
}

function makeSign(params, appSecret) {
  const sortedKeys = Object.keys(params)
    .filter((key) => {
      const value = params[key];

      return (
        key !== "sign" &&
        value !== undefined &&
        value !== null &&
        value !== ""
      );
    })
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
    timestamp: Math.floor(Date.now() / 1000).toString(),
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

function isSuccess(response) {
  return (
    response?.success === true ||
    response?.errorCode === 1000000 ||
    response?.error_code === 1000000
  );
}

async function main() {
  console.log("Temu return label upload - aftersales signature próbák");
  console.log("parentOrderSn:", PARENT_ORDER_SN);
  console.log("parentAfterSalesSn:", PARENT_AFTER_SALES_SN);
  console.log("trackingNumber:", TRACKING_NUMBER);
  console.log("PDF:", PDF_PATH);
  console.log("----------");

  if (!fs.existsSync(PDF_PATH)) {
    throw new Error(`Nem találom a PDF-et: ${PDF_PATH}`);
  }

  if (!RETURN_LABEL_PUBLIC_BASE_URL) {
    throw new Error("Hiányzik RETURN_LABEL_PUBLIC_BASE_URL a .env fájlból.");
  }

  if (!TEMU_PACKETA_CARRIER_ID) {
    throw new Error("Hiányzik TEMU_PACKETA_CARRIER_ID a .env fájlból.");
  }

  const publicBaseUrl = RETURN_LABEL_PUBLIC_BASE_URL.replace(/\/$/, "");
  const returnLabelUrl = `${publicBaseUrl}/${PDF_FILE_NAME}`;
  const carrierIdNumber = Number(TEMU_PACKETA_CARRIER_ID);

  console.log("returnLabelUrl:", returnLabelUrl);
  console.log("carrierId:", carrierIdNumber);
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

  if (!isSuccess(prepareResponse)) {
    console.log("Prepare sikertelen.");
    return;
  }

  const mallWarehouseId =
    prepareResponse?.result?.availableReturnWarehouseList?.[0]?.warehouseId ||
    null;

  if (!mallWarehouseId) {
    console.log("Nem találtam mallWarehouseId-t.");
    return;
  }

  console.log("mallWarehouseId:", mallWarehouseId);
  console.log("----------");

  console.log("1/b. Aftersales signature lekérés...");

  const signatureResponse = await callTemu("temu.aftersales.signature.get", {
    fileName: PDF_FILE_NAME,
    fileType: "pdf",
  });

  console.log(JSON.stringify(signatureResponse, null, 2));
  console.log("----------");

  if (!isSuccess(signatureResponse)) {
    console.log("Signature lekérés sikertelen.");
    return;
  }

  const aftersalesSignature = signatureResponse?.result?.signature || null;

  if (!aftersalesSignature) {
    console.log("Nem kaptam aftersales signature értéket.");
    return;
  }

  console.log(
    "aftersalesSignature:",
    aftersalesSignature.slice(0, 60) + "..."
  );
  console.log("----------");

  const logisticsWarehouseId = "WH-08329939107980321";

  const baseDto = {
    mallWarehouseId,
    returnLabelUrl,
    carrierId: carrierIdNumber,
    trackingNumber: TRACKING_NUMBER,
  };

  const logisticsWarehouseDto = {
    mallWarehouseId: logisticsWarehouseId,
    returnLabelUrl,
    carrierId: carrierIdNumber,
    trackingNumber: TRACKING_NUMBER,
  };

  const nowMs = Date.now();
  const in1DayMs = nowMs + 1 * 24 * 60 * 60 * 1000;
  const in7DaysMs = nowMs + 7 * 24 * 60 * 60 * 1000;

  const uploadVariants = [
    {
      name: "variant_1_base_without_aftersales_signature",
      payload: {
        parentAfterSalesSn: PARENT_AFTER_SALES_SN,
        parentOrderSn: PARENT_ORDER_SN,
        returnLabelDTOList: [baseDto],
      },
    },
    {
      name: "variant_2_top_level_signature",
      payload: {
        signature: aftersalesSignature,
        parentAfterSalesSn: PARENT_AFTER_SALES_SN,
        parentOrderSn: PARENT_ORDER_SN,
        returnLabelDTOList: [baseDto],
      },
    },
    {
      name: "variant_3_top_level_signature_with_version_v1",
      payload: {
        version: "V1",
        signature: aftersalesSignature,
        parentAfterSalesSn: PARENT_AFTER_SALES_SN,
        parentOrderSn: PARENT_ORDER_SN,
        returnLabelDTOList: [baseDto],
      },
    },
    {
      name: "variant_4_signature_inside_dto",
      payload: {
        parentAfterSalesSn: PARENT_AFTER_SALES_SN,
        parentOrderSn: PARENT_ORDER_SN,
        returnLabelDTOList: [
          {
            ...baseDto,
            signature: aftersalesSignature,
          },
        ],
      },
    },
    {
      name: "variant_5_fileSignature_top_level",
      payload: {
        fileSignature: aftersalesSignature,
        parentAfterSalesSn: PARENT_AFTER_SALES_SN,
        parentOrderSn: PARENT_ORDER_SN,
        returnLabelDTOList: [baseDto],
      },
    },
    {
      name: "variant_6_uploadSignature_top_level",
      payload: {
        uploadSignature: aftersalesSignature,
        parentAfterSalesSn: PARENT_AFTER_SALES_SN,
        parentOrderSn: PARENT_ORDER_SN,
        returnLabelDTOList: [baseDto],
      },
    },
    {
      name: "variant_7_returnLabelSignature_top_level",
      payload: {
        returnLabelSignature: aftersalesSignature,
        parentAfterSalesSn: PARENT_AFTER_SALES_SN,
        parentOrderSn: PARENT_ORDER_SN,
        returnLabelDTOList: [baseDto],
      },
    },
    {
      name: "variant_8_labelSignature_top_level",
      payload: {
        labelSignature: aftersalesSignature,
        parentAfterSalesSn: PARENT_AFTER_SALES_SN,
        parentOrderSn: PARENT_ORDER_SN,
        returnLabelDTOList: [baseDto],
      },
    },
    {
      name: "variant_9_pickup_mode_3_with_signature",
      payload: {
        signature: aftersalesSignature,
        parentAfterSalesSn: PARENT_AFTER_SALES_SN,
        parentOrderSn: PARENT_ORDER_SN,
        pickUpTimeScheduleMode: 3,
        latestTimestamp: in7DaysMs,
        returnLabelDTOList: [baseDto],
      },
    },
    {
      name: "variant_10_pickup_mode_1_with_signature",
      payload: {
        signature: aftersalesSignature,
        parentAfterSalesSn: PARENT_AFTER_SALES_SN,
        parentOrderSn: PARENT_ORDER_SN,
        pickUpTimeScheduleMode: 1,
        startTimestamp: in1DayMs,
        endTimestamp: in7DaysMs,
        returnLabelDTOList: [baseDto],
      },
    },
    {
      name: "variant_11_logistics_warehouse_with_signature",
      payload: {
        signature: aftersalesSignature,
        parentAfterSalesSn: PARENT_AFTER_SALES_SN,
        parentOrderSn: PARENT_ORDER_SN,
        returnLabelDTOList: [logisticsWarehouseDto],
      },
    },
  ];

  for (const variant of uploadVariants) {
    console.log("2. Upload próba:", variant.name);
    console.log("Payload:");
    console.log(JSON.stringify(variant.payload, null, 2));
    console.log("----------");

    const uploadResponse = await callTemu(
      "temu.aftersales.upload.returnlabel",
      variant.payload
    );

    console.log("Temu upload válasz:");
    console.log(JSON.stringify(uploadResponse, null, 2));
    console.log("----------");

    if (isSuccess(uploadResponse)) {
      console.log("SIKERES TEMU RETURN LABEL FELTÖLTÉS.");
      console.log("Sikeres variant:", variant.name);
      return;
    }

    console.log("Nem sikerült ezzel:", variant.name);
    console.log("----------");
  }

  console.log("Egyik upload variant sem sikerült.");
}

main().catch((error) => {
  console.error("Temu upload hiba:");

  if (error.response) {
    console.error("HTTP status:", error.response.status);
    console.error(error.response.data);
    return;
  }

  console.error(error.message);
});