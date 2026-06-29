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
      return key !== "sign" && value !== undefined && value !== null && value !== "";
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
  console.log("Temu return label upload - returnLabelDTOList verzió");
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

  const returnLabelUrl =
    `${RETURN_LABEL_PUBLIC_BASE_URL.replace(/\/$/, "")}/${PDF_FILE_NAME}`;

  console.log("returnLabelUrl:", returnLabelUrl);
  console.log("carrierId:", Number(TEMU_PACKETA_CARRIER_ID));
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

const payload = {
  parentAfterSalesSn: PARENT_AFTER_SALES_SN,
  parentOrderSn: PARENT_ORDER_SN,
  latestTimestamp: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60,
  returnLabelDTOList: [
      {
        mallWarehouseId,
        returnLabelUrl,
        carrierId: Number(TEMU_PACKETA_CARRIER_ID),
        trackingNumber: TRACKING_NUMBER,
      },
    ],
  };

  console.log("2. Upload payload:");
  console.log(JSON.stringify(payload, null, 2));
  console.log("----------");

  const uploadResponse = await callTemu(
    "temu.aftersales.upload.returnlabel",
    payload
  );

  console.log("Temu upload válasz:");
  console.log(JSON.stringify(uploadResponse, null, 2));
  console.log("----------");

  if (isSuccess(uploadResponse)) {
    console.log("SIKERES TEMU RETURN LABEL FELTÖLTÉS.");
    return;
  }

  console.log("Nem sikerült a Temu return label feltöltés.");
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