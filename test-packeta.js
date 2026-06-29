require("dotenv").config();

const axios = require("axios");
const fs = require("fs");
const path = require("path");

const {
  PACKETA_API_PASSWORD,
  PACKETA_ADDRESS_ID,
  PACKETA_LABEL_FORMAT = "A7 on A7",
  PACKETA_LABEL_POSITION = "0",
  PACKETA_RETURN_MODE = "complaint_assistant",
  PACKETA_RETURN_ASSISTANT_ID,
} = process.env;

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

function buildCreatePacketXml(packetData) {
  const returnAssistantXml = PACKETA_RETURN_ASSISTANT_ID
    ? `<returnAssistantId>${escapeXml(PACKETA_RETURN_ASSISTANT_ID)}</returnAssistantId>`
    : "";

  return `<?xml version="1.0" encoding="utf-8"?>
<createPacket>
  <apiPassword>${escapeXml(PACKETA_API_PASSWORD)}</apiPassword>
  <packetAttributes>
    <number>${escapeXml(packetData.orderNumber)}</number>

    <name>${escapeXml(packetData.customerName)}</name>
    <surname>${escapeXml(packetData.customerSurname || ".")}</surname>
    <email>${escapeXml(packetData.customerEmail)}</email>
    <phone>${escapeXml(packetData.customerPhone)}</phone>

    <addressId>${escapeXml(PACKETA_ADDRESS_ID)}</addressId>

    <value>${escapeXml(packetData.value)}</value>
    <currency>${escapeXml(packetData.currency)}</currency>

    <eshop>${escapeXml(packetData.eshop || "MedenceOrias")}</eshop>
    <note>${escapeXml(packetData.note)}</note>
    <weight>${escapeXml(packetData.weight || "1")}</weight>

    <returnPacket>1</returnPacket>
    <returnMode>${escapeXml(PACKETA_RETURN_MODE)}</returnMode>
    ${returnAssistantXml}
  </packetAttributes>
</createPacket>`;
}

function buildPacketLabelPdfXml(packetId) {
  return `<?xml version="1.0" encoding="utf-8"?>
<packetLabelPdf>
  <apiPassword>${escapeXml(PACKETA_API_PASSWORD)}</apiPassword>
  <packetId>${escapeXml(packetId)}</packetId>
  <format>${escapeXml(PACKETA_LABEL_FORMAT)}</format>
  <offset>${escapeXml(PACKETA_LABEL_POSITION)}</offset>
</packetLabelPdf>`;
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

async function main() {
  if (!PACKETA_API_PASSWORD) {
    throw new Error("Hiányzik a PACKETA_API_PASSWORD a .env fájlból.");
  }

  if (!PACKETA_ADDRESS_ID) {
    throw new Error("Hiányzik a PACKETA_ADDRESS_ID a .env fájlból.");
  }

  const packetData = {
    orderNumber: "PO-090-12329685781113212",
    customerName: "Rózsa Katalin",
    customerSurname: ".",
    customerEmail: "hwwiyhxnup130de@eul.shipping.temuemail.com",
    customerPhone: "+36304267556",
    value: 22544,
    currency: "HUF",
    eshop: "MedenceOrias",
    note: "Temu return label test - PO-090-12329685781113212",
    weight: "1",
  };

  const createXml = buildCreatePacketXml(packetData);

  console.log("Packeta createPacket kérés küldése...");
  console.log("addressId:", PACKETA_ADDRESS_ID);

  const createResponse = await callPacketaXml(createXml);
  console.log(createResponse);

  const status = extractTag(createResponse, "status");
  const packetId =
    extractTag(createResponse, "id") ||
    extractTag(createResponse, "packetId") ||
    extractTag(createResponse, "barcode");

  if (status !== "ok" || !packetId) {
    console.log("Nem sikerült packetId-t kinyerni.");
    return;
  }

  console.log("Packeta packetId:", packetId);

  const labelXml = buildPacketLabelPdfXml(packetId);

  console.log("Packeta PDF címke lekérése...");
  const labelResponse = await callPacketaXml(labelXml);

  const pdfBase64 = extractTag(labelResponse, "result");

  if (!pdfBase64) {
    console.log("Nem jött PDF result.");
    console.log(labelResponse);
    return;
  }

  const outputDir = path.join(__dirname, "labels");
  fs.mkdirSync(outputDir, { recursive: true });

  const outputPath = path.join(
    outputDir,
    `${packetData.orderNumber}-${packetId}.pdf`
  );

  fs.writeFileSync(outputPath, Buffer.from(pdfBase64, "base64"));

  console.log("PDF mentve ide:");
  console.log(outputPath);
}

main().catch((error) => {
  console.error("Packeta teszt hiba:");

  if (error.response) {
    console.error("HTTP status:", error.response.status);
    console.error(error.response.data);
    return;
  }

  console.error(error.message);
});