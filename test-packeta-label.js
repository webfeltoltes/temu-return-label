require("dotenv").config();

const axios = require("axios");
const fs = require("fs");
const path = require("path");

const {
  PACKETA_API_PASSWORD,
  PACKETA_LABEL_FORMAT = "A7 on A7",
  PACKETA_LABEL_POSITION = "1",
} = process.env;

const PACKETA_TEST_PACKET_ID = "3016356633";
const PACKETA_TEST_BARCODE = "Z3016356633";
const ORDER_NUMBER = "PO-090-12329685781113212";

function escapeXml(value) {
  if (value === null || value === undefined) return "";

  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function extractTag(xml, tagName) {
  const regex = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i");
  const match = xml.match(regex);
  return match ? match[1].trim() : null;
}

function extractAnyTag(xml, tagNames) {
  for (const tagName of tagNames) {
    const value = extractTag(xml, tagName);
    if (value) return value;
  }

  return null;
}

async function callPacketaXml(xml) {
  const response = await axios.post("https://www.zasilkovna.cz/api/rest", xml, {
    headers: {
      "Content-Type": "application/xml",
    },
    timeout: 30000,
  });

  return response.data;
}

function buildPacketLabelPdfXmlByPacketId(packetId, format) {
  return `<?xml version="1.0" encoding="utf-8"?>
<packetLabelPdf>
  <apiPassword>${escapeXml(PACKETA_API_PASSWORD)}</apiPassword>
  <packetId>${escapeXml(packetId)}</packetId>
  <format>${escapeXml(format)}</format>
  <offset>${escapeXml(PACKETA_LABEL_POSITION)}</offset>
</packetLabelPdf>`;
}

function buildPacketLabelPdfXmlByBarcode(barcode, format) {
  return `<?xml version="1.0" encoding="utf-8"?>
<packetLabelPdf>
  <apiPassword>${escapeXml(PACKETA_API_PASSWORD)}</apiPassword>
  <barcode>${escapeXml(barcode)}</barcode>
  <format>${escapeXml(format)}</format>
  <offset>${escapeXml(PACKETA_LABEL_POSITION)}</offset>
</packetLabelPdf>`;
}

async function tryLabel(format, useBarcode = false) {
  console.log("Próba label format:", format);
  console.log("Azonosító:", useBarcode ? PACKETA_TEST_BARCODE : PACKETA_TEST_PACKET_ID);

  const xml = useBarcode
    ? buildPacketLabelPdfXmlByBarcode(PACKETA_TEST_BARCODE, format)
    : buildPacketLabelPdfXmlByPacketId(PACKETA_TEST_PACKET_ID, format);

  const response = await callPacketaXml(xml);
  console.log(response);

  const status = extractTag(response, "status");

  if (status && status !== "ok") {
    return false;
  }

  const pdfBase64 = extractAnyTag(response, [
    "result",
    "pdf",
    "content",
    "data",
  ]);

  if (!pdfBase64) {
    return false;
  }

  const outputDir = path.join(__dirname, "labels");
  fs.mkdirSync(outputDir, { recursive: true });

  const safeFormat = format.replace(/[^a-z0-9]+/gi, "_");

  const outputPath = path.join(
    outputDir,
    `${ORDER_NUMBER}-${PACKETA_TEST_PACKET_ID}-${safeFormat}.pdf`
  );

  fs.writeFileSync(outputPath, Buffer.from(pdfBase64, "base64"));

  console.log("PDF mentve ide:");
  console.log(outputPath);

  return true;
}

async function main() {
  if (!PACKETA_API_PASSWORD) {
    throw new Error("Hiányzik a PACKETA_API_PASSWORD a .env fájlból.");
  }

  const formatsToTry = [
    PACKETA_LABEL_FORMAT,
    "A7 on A7",
    "A6 on A6",
    "A8 on A8",
  ];

  const uniqueFormats = [...new Set(formatsToTry.filter(Boolean))];

  for (const format of uniqueFormats) {
    const okByPacketId = await tryLabel(format, false);

    if (okByPacketId) {
      console.log("Sikeres PDF packetId alapján.");
      return;
    }

    console.log("PacketId alapján nem sikerült, próbálom barcode alapján...");

    const okByBarcode = await tryLabel(format, true);

    if (okByBarcode) {
      console.log("Sikeres PDF barcode alapján.");
      return;
    }

    console.log("Nem sikerült ezzel a formátummal:", format);
    console.log("----------");
  }

  console.log("Egyik címkeformátummal sem sikerült PDF-et lekérni.");
}

main().catch((error) => {
  console.error("Packeta PDF teszt hiba:");

  if (error.response) {
    console.error("HTTP status:", error.response.status);
    console.error(error.response.data);
    return;
  }

  console.error(error.message);
});