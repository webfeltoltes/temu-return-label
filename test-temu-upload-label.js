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
    .filter((key) => key !== "sign" && params[key] !== undefined && params[key] !== null)
    .sort();

  let signStr = appSecret;

  for (const key of sortedKeys) {
    signStr += key + signValue(params[key]);
  }

  signStr += appSecret;

  return crypto.createHash("md5").update(signStr, "utf8").digest("hex").toUpperCase();
}

async function callTemu(type, payload = {}) {
  if (!TEMU_APP_KEY || !TEMU_APP_SECRET || !TEMU_ACCESS_TOKEN) {
    throw new Error("Hiányzik TEMU_APP_KEY / TEMU_APP_SECRET / TEMU_ACCESS_TOKEN a .env fájlból.");
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

async function uploadGeneralFile(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Nem találom a PDF fájlt: ${filePath}`);
  }

  if (!TEMU_APP_KEY || !TEMU_APP_SECRET || !TEMU_ACCESS_TOKEN) {
    throw new Error("Hiányzik TEMU_APP_KEY / TEMU_APP_SECRET / TEMU_ACCESS_TOKEN a .env fájlból.");
  }

  const timestamp = Math.floor(Date.now() / 1000);

  const params = {
    type: "api.galerie.general_file.upload",
    app_key: TEMU_APP_KEY,
    access_token: TEMU_ACCESS_TOKEN,
    timestamp,
    data_type: "JSON",
  };

  params.sign = makeSign(params, TEMU_APP_SECRET);

  const form = new FormData();

  for (const [key, value] of Object.entries(params)) {
    form.append(key, value);
  }

  form.append("file", fs.createReadStream(filePath), {
    filename: path.basename(filePath),
    contentType: "application/pdf",
  });

  const uploadUrl = TEMU_API_URL;

  const response = await axios.post(uploadUrl, form, {
    headers: form.getHeaders(),
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
    timeout: 60000,
  });

  return response.data;
}

function findFileId(obj) {
  if (!obj || typeof obj !== "object") return null;

  const possibleKeys = [
    "fileId",
    "file_id",
    "fileUrl",
    "file_url",
    "url",
    "uri",
    "id",
  ];

  for (const key of possibleKeys) {
    if (obj[key]) return obj[key];
  }

  for (const value of Object.values(obj)) {
    if (value && typeof value === "object") {
      const found = findFileId(value);
      if (found) return found;
    }
  }

  return null;
}

async function main() {
  console.log("PDF ellenőrzés:");
  console.log(PDF_PATH);

  if (!fs.existsSync(PDF_PATH)) {
    throw new Error("A PDF fájl nem létezik ezen az útvonalon.");
  }

  console.log("1. Temu returnlabel prepare lekérés...");

  const prepareResponse = await callTemu("temu.aftersales.returnlabel.prepare.get", {
    parentOrderSn: PARENT_ORDER_SN,
    parentAfterSalesSn: PARENT_AFTER_SALES_SN,
  });

  console.log(JSON.stringify(prepareResponse, null, 2));

  console.log("2. PDF feltöltés Temuba general_file upload végponton...");

  const fileUploadResponse = await uploadGeneralFile(PDF_PATH);

  console.log(JSON.stringify(fileUploadResponse, null, 2));

  const fileId = findFileId(fileUploadResponse);

  if (!fileId) {
    console.log("Nem találtam fileId / fileUrl értéket a Temu upload válaszban.");
    console.log("A következő lépéshez látni kell, milyen mezőt ad vissza a Temu.");
    return;
  }

  console.log("Talált Temu file azonosító:");
  console.log(fileId);

  console.log("3. Return label feltöltése aftersales-re...");

  const uploadReturnLabelResponse = await callTemu("temu.aftersales.upload.returnlabel", {
    parentOrderSn: PARENT_ORDER_SN,
    parentAfterSalesSn: PARENT_AFTER_SALES_SN,
    returnLabelFileId: fileId,
  });

  console.log(JSON.stringify(uploadReturnLabelResponse, null, 2));

  console.log("Kész.");
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